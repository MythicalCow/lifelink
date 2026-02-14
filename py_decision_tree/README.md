# LoRa Mesh AI Triage (py_decision_tree)

Lightweight **offline** text triage for a LoRa mesh: classify messages as **vital** or **normal**, then (if vital) predict intent and urgency so the network can send short, reliable payloads for critical traffic and full ASCII for the rest.

---

## Compact message format (API for consumers)

When a message is classified as **vital**, the mesh sends a **compact ASCII payload** instead of the raw text. Downstream services (routing, logging, UI, other nodes) must parse this format to interpret the message.

### Schema

```
INTENT|U{urgency}|F{flags}|N{count}|L{location}
```

- **Delimiter:** Pipe `|` (ASCII 0x7C). Order of fields is fixed.
- **All fields are required.** No escaping; payloads do not contain `|` inside a field.

| Field   | Form    | Description |
|--------|---------|-------------|
| INTENT | string  | One of the intent labels below. |
| U      | U0–U3   | Urgency: 0 = low, 1 = medium, 2 = high, 3 = critical. |
| F      | F0–F7   | Flags (decimal): bit0 = needs_location, bit1 = needs_confirmation. |
| N      | N0–N99  | Extracted count (e.g. “2 injured” → N2). 0 if none. |
| L      | string  | Coarse location token or `unknown`. |

### Intent values

| Intent   | Meaning / typical use |
|----------|------------------------|
| MEDIC    | Medical emergency, injury, need for doctor/paramedic. |
| DANGER   | Armed threat, violence, explosion, fire (conflict), bomb, sniper. |
| EVAC     | Evacuation, need to leave, safe route, extraction. |
| WATER    | Need for water, dehydration, clean water, running out. |
| FOOD     | Need for food, rations, hunger, supplies. |
| SHELTER  | Need for shelter, tent, warmth, safe place to stay. |
| INFO     | Request for information, status, update, check-in. |
| DISASTER | Natural disaster: flood, earthquake, tsunami, landslide, wildfire, etc. |
| SICKNESS | Illness, outbreak, fever, infection, food poisoning, symptoms. |

(Only vital messages use this schema; **CHAT** is non-vital and is sent as full ASCII.)

### Flags (F)

- **F & 1 (bit0) = 1** → Sender **needs to provide location** (e.g. app should prompt for GPS or place).
- **F & 2 (bit1) = 1** → Message **may need confirmation** (e.g. DANGER/EVAC/DISASTER); treat as unverified until corroborated if your system supports it.

Examples: `F0` = no flags, `F1` = needs location, `F2` = needs confirmation, `F3` = both.

### Location (L)

Coarse token from a fixed set: `library`, `bridge`, `camp`, `market`, `hospital`, `school`, or `unknown` if none matched. Use for routing or display only; not precise coordinates.

### Parsing example (pseudocode)

```
split payload on "|" → [INTENT, U_str, F_str, N_str, L_str]
urgency = int(U_str[1])           // drop "U"
flags   = int(F_str[1])          // drop "F"
count   = int(N_str[1])          // drop "N"
location = L_str[1:]             // drop "L"
needs_location  = (flags & 1) != 0
needs_confirmation = (flags & 2) != 0
```

### Example payloads

| Payload                  | Interpretation |
|--------------------------|----------------|
| `MEDIC|U3|F0|N2|Lbridge` | Medic needed, critical urgency, 2 people, at bridge, location given. |
| `DANGER|U3|F2|N0|Lmarket` | Danger at market, critical, needs confirmation, no count. |
| `WATER|U1|F1|N0|Lunknown` | Water needed, medium urgency, location missing (prompt user). |
| `DISASTER|U3|F0|N0|Lcamp`  | Disaster at camp, critical. |

**Non-vital messages** are sent as **full ASCII** (no compact format). Consumers can treat any payload that does not match `^[A-Z]+\|U[0-3]\|F[0-9]+\|N[0-9]+\|L[a-z]+$` as normal chat / opaque text.

---

## What it does

1. **Input:** A single text message (e.g. from a phone over BLE).
2. **Gate:** Binary **is_vital** — is this urgent/safety/resource-critical?
3. **If vital:** Predict **intent** (MEDIC, DANGER, EVAC, WATER, FOOD, SHELTER, INFO, DISASTER, SICKNESS), **urgency** (0–3), and extract count/location. Emit a compact payload like `MEDIC|U3|F0|N2|Lbridge` for LoRa.
4. **If normal:** Send the **full ASCII** message (no compression).

So: **vital → short schema payload; normal → full text.** This saves airtime when it matters and keeps UX simple for chat.

## Project layout

```
py_decision_tree/
├── README.md           # This file
├── context.markdown    # Full product/design context
├── treehacks_proto.py  # Demo: train + run triage examples
├── export_cpp.py       # Train and export trees to C++ for ESP32
└── lib/                # Library (import from here)
    ├── __init__.py
    ├── data_gen.py     # Synthetic data, templates, make_dataset()
    ├── vectorizer.py   # Text → 82-dim vector (structure + keywords + 4-grams)
    ├── train.py        # Train is_vital gate, then intent/urgency on vital subset
    └── infer.py        # triage(), payload formatting
```

## Quick start

From the `py_decision_tree` directory:

```bash
# Demo: train models and run example sentences
python treehacks_proto.py

# Export trained trees to C++ for ESP32
python export_cpp.py
```

Requires: `numpy`, `pandas`, `scikit-learn`.

## Pipeline (how it works)

1. **Data** — `lib.data_gen.make_dataset(n_per_intent, n_normal, seed)`  
   Builds a DataFrame with synthetic messages: vital intents (MEDIC, DANGER, EVAC, WATER, FOOD, SHELTER, INFO, DISASTER, SICKNESS), CHAT, and extra “normal” sentences (including adversarial ones like “that movie was fire”).  
   Config is in globals: `LOC_CUES`, `CONFIRM_INTENTS`, `URGENT_KEYWORDS`, `PLACE_TOKENS`, `BUCKETS`, etc., so you can extend cues and intents in one place.

2. **Features** — `lib.vectorizer.build_vector(text)`  
   Maps each message to an 82-dim vector:
   - 8 structure features (word/char length, digits, `!`/`?`, caps ratio, time/location hints),
   - 10 keyword-bucket counts (per intent),
   - 64 hashed character 4-grams (FNV-1a).  
   No learned embeddings; suitable for ESP32.

3. **Training** — `lib.train.main(...)`  
   - Fit a decision tree for **is_vital** on the full dataset.
   - Fit **intent** and **urgency** trees only on the **vital** subset.
   - Reports accuracy, classification report, and confusion matrices.

4. **Inference** — `lib.infer.triage(text, vital_clf, intent_clf, urg_clf)`  
   Returns `(is_vital, payload)`. If not vital, `payload` is `None` (send full ASCII). If vital, `payload` is the compact string (e.g. `MEDIC|U3|F0|N2|Lbridge`).

5. **Export** — `export_cpp.py`  
   Writes C++ arrays (feature index, threshold, left/right, leaf class) and a small predict loop for each tree, for use on ESP32.

## Preventing data leakage

**Data leakage** here means test (or validation) information influencing training, which inflates metrics and gives a false sense of performance.

### What we avoid already

- **Strict train/test split:** Test data is not used for fitting.
- **No test-time stats in features:** The vectorizer uses only fixed keyword lists and FNV-1a hashing. No per-dataset statistics (e.g. IDF, mean) are computed from the training set and applied to test, so no leakage from preprocessing.
- **Labels:** We stratify by `is_vital` for balance; we do not use test labels for training.

### Remaining risk: same synthetic pool

If you generate **one** big dataset with a single `seed` and then do a random train/test split, train and test are **different rows** but from the **same random draw** of templates (same locations, same phrasing distribution). The model can overfit to that shared structure, so metrics can be optimistic.

### Recommended: separate train and test seeds

Generate train and test with **different seeds** so the test set is an independent draw from the same template grammar (no overlap with training sentences):

```python
from lib.train import main

# Test set is generated with seed=999; no sentence in test appears in train
vital_clf, intent_clf, urg_clf = main(
    n_per_intent=250,
    n_normal=2000,
    seed=7,
    test_seed=999,   # independent test set
    test_size=0.25, # ignored when test_seed is set
)
```

With `test_seed` set, `train.main()` builds a training dataset with `seed` and a **separate** test dataset with `test_seed`. No test sentence is used for training, so there is no overlap and no leakage from the synthetic pool.

## Config and extending

- **Location / confirmation / urgency** — In `lib/data_gen.py`: extend `LOC_CUES`, `CONFIRM_INTENTS`, `URGENT_KEYWORDS`, `PLACE_TOKENS`, and the intent lists as needed. Same lists drive data generation and (via `infer`) payload flags.
- **Intents and keywords** — Adjust `INTENTS`, `VITAL_INTENTS`, and `BUCKETS` in `data_gen.py`; the vectorizer and training use them automatically.
