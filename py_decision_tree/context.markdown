# Context: LoRa Mesh AI Triage MVP (TreeHacks)

## Project Intent
Build a decentralized, offline communication network for disrupted environments where internet/WiFi may be blocked. The system is a low-cost ESP32 + LoRa mesh (Meshtastic-like). Users connect to a nearby node via a phone app (BLE), type any sentence, and the system locally decides whether the message is vital or normal.

Core principle: **LoRa airtime is scarce**, so we prioritize and compress only when needed. If a message is not urgent or safety-critical, we transmit it as a normal full ASCII message for best user experience and simplicity.

## High-Level UX
User types any sentence. The system:
1) Runs a lightweight local classifier (decision tree) to determine:
   - `is_vital` (true/false)
   - `intent` (MEDIC, DANGER, EVAC, WATER, FOOD, SHELTER, INFO, CHAT)
   - `urgency` (0–3)
   - optional `needs_location`, `needs_confirmation`, extracted `count`, coarse `location_token`
2) If `is_vital == false`:
   - send **full ASCII** text message over LoRa (or chunked if needed)
3) If `is_vital == true`:
   - send compact, schema-based payload (binary or short ASCII) optimized for reliability and retransmission

Goal: maximize ease of use while conserving airtime when it matters most.

## Why “AI” Here
The AI component is a tiny text-to-label system that runs locally:
- No cloud
- Works offline
- Can run on ESP32 (C++)

It is not meant to deeply “understand” language. It is meant to **triage** messages based on cues correlated with urgency, danger, and location presence.

## Decentralization Requirements
- No central server or internet
- Mesh partitions and intermittent connectivity are expected
- Local decisions per node
- The system should remain useful under congestion and adversarial conditions

## Core MVP Behavior
### Vital Message Path (Compressed)
If vital:
- Produce compact labels and structured fields
- Use stronger retransmission/TTL/hop limits
- Optionally require confirmations for high-risk events

Example:
- Input: “Need a medic for 2 injured people near the bridge ASAP!”
- Output: `MEDIC|U3|F0|N2|Lbridge`

Where:
- `MEDIC` = intent label
- `U3` = urgency (0–3)
- `F` = flags bitfield (ex: needs_location, needs_confirmation)
- `N` = extracted count
- `L` = coarse location token (bridge, camp, etc)

### Normal Message Path (Full ASCII)
If not vital:
- Send full ASCII message payload for user convenience and correctness
- Avoid lossy compression unless airtime conditions demand it
- This also reduces classification risk for harmless chatter

This design choice enables:
- Less pressure to perfectly classify all messages
- Stronger focus on “vital vs normal” distinction
- Better training: the model should be tuned around urgency/danger/location cues

## Modeling Targets
### Primary Gate (Most Important)
Binary classifier:
- `is_vital`: true/false

Definition of “vital” (MVP scope):
- likely urgent, safety-critical, or resource-critical
- contains cues of harm/danger/medical needs, evacuation, immediate supplies, or time pressure
- often includes location reference or should request it

### Secondary Labels (Only If Vital)
- `intent`: MEDIC, DANGER, EVAC, WATER, FOOD, SHELTER, INFO
- `urgency`: 0–3
- `needs_location`: true/false
- `needs_confirmation`: true/false (especially for DANGER/EVAC)
- `count`: first integer found (0 if absent)
- `location_token`: coarse place dictionary hit, or “unknown”

## Current Encoder Design (No Word2Vec Required)
Text is mapped to a fixed vector for decision tree input.

Recommended vector (80 dims total):
1) Structure features (8 dims)
   - normalized word count
   - normalized char count
   - digit count
   - punctuation flags (! ?)
   - caps ratio
   - time-word flag (asap, urgent, now)
   - location-hint flag (near/at/by/coords etc.)
2) Keyword bucket counts (8 dims)
   - counts of matches from per-intent keyword lists
   - tuned heavily toward **vital cues** (injury, danger, urgency, location)
3) Hashed character 4-grams (64 dims)
   - char 4-grams hashed into 64 bins (FNV-1a)
   - robust to typos and phrasing variation

Notes:
- This encoder is cheap enough for ESP32.
- It is not an LLM. It is designed specifically for triage labels.

## Training Focus: “Vital Words” and Cues
Since normal messages can be sent as full ASCII, training should emphasize:
- urgency words: asap, urgent, now, immediately, right away
- danger words: shots, gunfire, attack, explosion, fire, bomb, sniper
- medical words: medic, injured, bleeding, unconscious, pain
- location cues: near, at, behind, by, next to, coords, gps, named places
- counts: “2 injured”, “5 people”, etc.
- disambiguation negatives: “that movie was fire”, “lol urgent” (not actually vital)

The objective is high precision for “vital vs normal” and good recall for truly vital messages.

## Synthetic Dataset Generation (Current) and Improvements
### Current
Template-based generation with:
- random locations (library/bridge/camp/market/hospital/school)
- random counts
- optional urgency words
- typo injection
- intent label and urgency label (rule-based)

### Improvements Needed
1) Separate synthetic data generation into its own file (`data_gen.py`)
2) Increase diversity and realism:
   - multi-intent sentences (“need water and medic at camp”)
   - slang, abbreviations, misspellings, and short fragments (“medic 2 ppl bridge asap”)
   - adversarial text (spam, repeated false alarms)
   - false keyword hits (“this is fire”, “shooting a video”)
3) Add a real human-written dataset:
   - teammates write 50–100 sentences per category
   - include typos, slang, and realistic phrasing
4) Reframe labels around the gate:
   - generate a larger set of normal chat messages
   - ensure the dataset is not overly separable by templates

Recommended scale:
- 20,000+ synthetic examples
- 500–2,000 human-written examples

## Codebase Structure (Recommended)
- `data_gen.py`
  - templates, keyword lists, typo injection
  - `make_dataset(n_per_intent, n_normal, seed) -> DataFrame`
- `vectorizer.py`
  - normalization
  - feature extraction
  - `build_vector(text) -> np.ndarray`
- `train.py`
  - train `is_vital` gate model
  - train intent/urgency models on vital subset
  - evaluation and confusion matrices
- `export_cpp.py`
  - export trained trees to C++ code (ESP32)
- `infer.py`
  - inference wrapper and payload formatting

## C++ on ESP32 (Instead of C)
We will deploy inference in **C++** on ESP32 for easier development and use of `std` utilities (while still avoiding dynamic allocations at runtime).

Key constraints:
- avoid heap allocations in hot path
- fixed-size arrays for features
- predictable runtime O(tree depth)
- no dependency on heavy libraries

Recommended embedded representation:
- array-based tree traversal (compact and predictable)
- optional `std::array` for features and node arrays

## Exporting the Decision Tree to C++ for ESP32
### Goal
Convert sklearn DecisionTree models into a small C++ inference function runnable on-device.

Two export styles:
1) Nested `if/else` code
   - fast, readable
   - can get large with deeper trees
2) Array-based traversal (recommended)
   - smaller and structured
   - predictable memory footprint

Array-based node representation:
- `feature[i]` (int16)
- `threshold[i]` (float or fixed-point int16)
- `left[i]`, `right[i]` (int16)
- `leaf_value[i]` (uint8 class at leaf; use sentinel for internal nodes)

Traversal:
- start at node 0
- if leaf, return class
- else compare `x[feature[i]]` with `threshold[i]`
- move to left or right child

### Tracking Model Size
Compute and report:
- `node_count`
- `max_depth`
- estimated flash footprint

Rough storage estimate (array traversal):
- feature: 2 bytes
- threshold: 4 bytes (float) or 2 bytes (fixed-point)
- left/right: 2 + 2 bytes
- leaf class: 1 byte (or separate leaf array)
Approx per node:
- float threshold: ~11–12 bytes aligned
- fixed-point threshold: ~9–10 bytes aligned

Example:
- 200 nodes x 12 bytes ≈ 2.4 KB model storage (plus code overhead)

Also track:
- feature vector storage
  - 80 floats = 320 bytes
  - can compress to uint8 or int16 fixed-point to reduce RAM and speed comparisons

## Payload Strategy
### Normal Message (Not Vital)
- Send full ASCII message as-is.
- Optional: chunking if longer than LoRa payload limits.
- This reduces user friction and avoids wrong compression.

### Vital Message (Triage)
- Send compact schema-based payload.
- Use stronger retransmission budgets and TTL.
- Optionally include a small human-readable summary for debugging/demo.

Schema candidates:
1) Demo-readable ASCII:
   - `MEDIC|U3|F0|N2|Lbridge`
2) Real constraint binary:
   - intent: 3 bits
   - urgency: 2 bits
   - flags: 3–5 bits
   - count: 7 bits
   - location: 6–10 bits
   - fits in ~3–6 bytes

Recommendation:
- keep ASCII for hackathon demo
- implement binary as “future work” or optional toggle

## Triage Flags and Follow-up UX
If model outputs:
- `needs_location == true`:
  - phone app prompts user for a location pin or quick selection
- `needs_confirmation == true`:
  - show “unverified” until k-of-n confirmations arrive (future work)
- For low confidence:
  - fallback to sending full ASCII message
  - or ask a single follow-up question in the app

## Success Metrics for Demo
- Airtime saved:
  - vital messages become short payloads
  - normal messages remain full ASCII (but fewer network-wide retransmits)
- Delivery rate:
  - vital messages delivered more reliably under congestion
- Duplicate suppression rate (optional)
- Classification accuracy:
  - especially `is_vital` precision/recall on human-written test set
- Model size:
  - node count, max depth, estimated flash usage
- Latency:
  - time from phone send to mesh deliver

## Non-Goals for MVP
- Full natural language understanding
- Perfect translation
- Strong Sybil resistance and cryptographic identity
- Perfect misinformation handling

These can be listed as future improvements.

## Future Improvements (Optional)
- Bandit-based routing with ACK-based rewards
- Decentralized trust scoring via k-of-n event corroboration
- Federated learning of keyword lists or threshold tuning
- Encryption/signatures for authenticity
- Phone-side encoder (more powerful) with ESP32 receiving only labels via BLE