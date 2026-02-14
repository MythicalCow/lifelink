"""
Synthetic dataset generation for LoRa mesh AI triage.
Templates, keyword lists, typo injection, and make_dataset(n_per_intent, n_normal, seed).
"""
import random
import re
import string

import pandas as pd

# Vital intents (is_vital=True); CHAT is non-vital
INTENTS = ["MEDIC", "WATER", "FOOD", "SHELTER", "DANGER", "EVAC", "INFO", "DISASTER", "SICKNESS", "CHAT"]
VITAL_INTENTS = ["MEDIC", "DANGER", "EVAC", "WATER", "FOOD", "SHELTER", "INFO", "DISASTER", "SICKNESS"]

BUCKETS = {
    "MEDIC": [
        "medic", "doctor", "injured", "bleed", "bleeding", "unconscious", "hurt", "wounded", "ambulance", "pain",
        "trauma", "emergency", "critical", "wound", "wounds", "fracture", "broken bone", "stabilize", "first aid",
        "paramedic", "nurse", "hospital", "bleeding out", "hemorrhage", "concussion", "laceration", "stitches",
        "cardiac", "cpr", "resuscitate", "collapse", "unresponsive", "casualty", "casualties", "not talking"
    ],
    "WATER": [
        "water", "thirsty", "dehydration", "bottle", "well", "hydration", "drink", "drinking",
        "dry", "clean water", "potable", "running out of water", "no water", "water supply",
        "thirst", "parched", "reservoir", "purify", "filter", "cistern", "faucet", "running water",
    ],
    "FOOD": [
        "food", "hungry", "ration", "rice", "bread", "meal", "starving", "rations", "supplies",
        "feed", "feeding", "malnutrition", "famine", "provisions", "groceries", "eat", "eating",
        "kitchen", "cook", "cooking", "starvation", "no food", "out of food", "need food", "run out",
    ],
    "SHELTER": [
        "shelter", "tent", "roof", "cold", "sleep", "blanket", "safehouse", "housing",
        "warm", "warmth", "indoors", "building", "refuge", "camp", "campsite", "bed",
        "sleeping", "freezing", "hypothermia", "frostbite", "nowhere to stay", "homeless", "evicted",
    ],
    "DANGER": [
        "gun", "shooting", "shots", "explosion", "attack", "fire", "bomb", "sniper", "danger",
        "gunfire", "armed", "weapon", "weapons", "violence", "hostile", "strike", "striking",
        "explosive", "blast", "IED", "grenade", "ambush", "raid", "invasion", "threat", "threatened",
    ],
    "EVAC": [
        "evacuate", "leave", "run", "escape", "exit", "safe route", "move out", "relocate",
        "evacuation", "evac", "get out", "flee", "fleeing", "exodus", "withdraw", "pull out",
        "route out", "safe path", "clear path", "extract", "extraction", "rescue", "evacuees",
    ],
    "INFO": [
        "where", "when", "status", "update", "check-in", "anyone", "need info", "what's up", "whats up",
        "news", "situation", "report", "intel", "intelligence", "briefing", "sitrep", "location of",
        "anyone know", "heard", "rumor", "confirmed", "unconfirmed", "latest", "current",
    ],
    "DISASTER": [
        "flood", "flooding", "flooded", "water everywhere", "earthquake", "quake", "tsunami",
        "landslide", "hurricane", "tornado", "storm", "disaster", "natural disaster", "wildfire",
        "mudslide", "avalanche", "cyclone", "typhoon", "drought", "blizzard", "hail",
        "building collapse", "collapsed", "washed away", "inundated", "submerged", "trapped",
    ],
    "SICKNESS": [
        "sick", "illness", "ill", "fever", "cough", "virus", "disease", "vomiting", "diarrhea",
        "symptoms", "infection", "infected", "contagious", "outbreak", "epidemic", "pandemic",
        "nausea", "dizzy", "weak", "can't breathe", "shortness of breath", "chest pain",
        "allergic", "allergy", "reaction", "poisoning", "food poisoning", "dehydrated",
    ],
    "CHAT": [
        "lol", "ok", "okay", "thanks", "thank you", "see you", "brb", "hi", "hello", "good", "nice",
        "hey", "yeah", "yep", "nope", "sure", "cool", "great", "fine", "bye", "later",
        "got it", "understood", "copy", "roger", "check", "alright", "whatever", "k",
    ],
}

TIME_WORDS = ["now", "asap", "urgent", "tonight", "immediately", "right away", "soon", "quick"]
LOC_WORDS = [
    "at", "near", "behind", "by", "next to", "around", "in", "gps", "coords", "coordinate", "location",
    "library", "bridge", "camp", "market", "hospital", "school",
]

LOCATIONS = [
    "near the library", "by the bridge", "at camp", "behind the market",
    "next to the school", "at the hospital",
]
COUNTS = ["1", "2", "3", "5", "10"]
PLACE_TOKENS = ["library", "bridge", "camp", "market", "hospital", "school"]

# Location cues: if present in text, we assume location is given (needs_location = False)
LOC_CUES = ["near", "at", "by", "behind", "next to", "coords", "gps", "location"]

# Intents that require confirmation (e.g. DANGER/EVAC/DISASTER)
CONFIRM_INTENTS = ["DANGER", "EVAC", "DISASTER"]

# Words that signal urgency for label_urgency()
URGENT_KEYWORDS = ["urgent", "asap", "immediately", "right away", "now"]

TEMPLATES = {
    "MEDIC": [
        "need a medic {loc}",
        "we have {n} injured {loc}",
        "bleeding badly {loc} need doctor",
        "unconscious person {loc} urgent",
        "hurt and in pain {loc} please help",
        "medic 2 ppl bridge asap",
        "2 injured need doctor near camp",
    ],
    "WATER": [
        "need water {loc}",
        "thirsty {loc} running out of water",
        "no clean water {loc} urgent",
        "dehydration risk {loc} need bottles",
        "looking for a well {loc}",
        "water runnin out at {loc}",
    ],
    "FOOD": [
        "need food {loc}",
        "hungry {loc} no rations left",
        "out of rice and bread {loc}",
        "need a meal for {n} people {loc}",
        "starving {loc} please send food",
        "food for {n} at {loc} asap",
    ],
    "SHELTER": [
        "need shelter {loc}",
        "cold night {loc} need blanket",
        "need a safehouse {loc} urgent",
        "no roof {loc} need tent",
        "need a place to sleep {loc}",
        "shelter tonight {loc}",
    ],
    "DANGER": [
        "shots fired {loc} urgent",
        "gunfire {loc} stay away",
        "explosion {loc} danger",
        "attack happening {loc} run",
        "fire spreading {loc} urgent",
        "sniper near {loc}",
        "bomb threat {loc} evacuate",
    ],
    "EVAC": [
        "evacuate {loc} now",
        "need safe route to exit {loc}",
        "we should leave {loc} asap",
        "relocate {loc} immediately",
        "run and escape {loc} danger",
        "get out of {loc} now",
    ],
    "INFO": [
        "any update {loc}?",
        "where is the water point {loc}?",
        "status update {loc} please",
        "when is the pickup {loc}?",
        "anyone know whats up {loc}?",
        "need info on {loc}",
    ],
    "DISASTER": [
        "flooding {loc} water everywhere",
        "earthquake {loc} building collapse",
        "flood {loc} need evac urgent",
        "landslide {loc} people trapped",
        "tsunami warning {loc} get to high ground",
        "wildfire spreading {loc} evacuate now",
        "flooded {loc} need rescue",
    ],
    "SICKNESS": [
        "people sick {loc} need medic",
        "outbreak {loc} fever and vomiting",
        "many ill {loc} need supplies",
        "sickness spreading {loc} urgent",
        "can't breathe {loc} need help",
        "food poisoning {n} people {loc}",
        "infection {loc} need medicine",
    ],
    "CHAT": [
        "hi {loc}",
        "ok thanks {loc}",
        "lol {loc}",
        "see you {loc}",
        "all good {loc}",
        "brb",
        "hello everyone",
        "that was helpful thanks",
    ],
}

# Normal-only sentences: no intent, casual, or false keyword hits (adversarial)
NORMAL_TEMPLATES = [
    "lol ok see you later",
    "that movie was fire",
    "shooting a video at the park",
    "we're good no worries",
    "thanks for the update",
    "okay cool",
    "hi how are you",
    "just checking in nothing urgent",
    "maybe later",
    "no rush",
    "all good here",
    "nothing to report",
    "chat later",
    "got it thanks",
    "sounds good",
    "kk",
    "nice one",
    "that's funny",
    "wait what",
    "idk",
    "same here",
    "cool cool",
    "yeah nah",
    "catch you later",
    "peace",
    "urgent meeting at 5 lol",
    "this is fire (the food)",
    "we need to evacuate this conversation",
    "medic we need more snacks",
]


def introduce_typos(word: str, p: float = 0.15) -> str:
    if random.random() > p or len(word) < 4:
        return word
    w = list(word)
    r = random.random()
    if r < 0.33:
        i = random.randrange(len(w))
        del w[i]
    elif r < 0.66:
        i = random.randrange(max(1, len(w) - 1))
        w[i], w[i + 1] = w[i + 1], w[i]
    else:
        i = random.randrange(len(w))
        w[i] = random.choice(string.ascii_lowercase)
    return "".join(w)


def _apply_typos_to_tokens(s: str, typo_prob: float = 0.25) -> str:
    tokens = re.findall(r"[a-zA-Z0-9']+|[^\w\s]", s.lower())
    new_tokens = []
    for t in tokens:
        if re.match(r"[a-zA-Z]{4,}", t) and random.random() < typo_prob:
            new_tokens.append(introduce_typos(t, p=0.6))
        else:
            new_tokens.append(t)
    return " ".join(new_tokens).replace("  ", " ").strip()


def sample_sentence(intent: str) -> str:
    loc = random.choice(LOCATIONS)
    n = random.choice(COUNTS)
    template = random.choice(TEMPLATES[intent])
    s = template.format(loc=loc, n=n)

    if random.random() < 0.35:
        s += " " + random.choice(TIME_WORDS)
    if random.random() < 0.25:
        s += " please"

    s = _apply_typos_to_tokens(s)

    if random.random() < 0.15:
        s += "!"
    if random.random() < 0.10:
        s += "?"
    return s


def sample_normal_sentence() -> str:
    s = random.choice(NORMAL_TEMPLATES)
    if random.random() < 0.2:
        s = _apply_typos_to_tokens(s, typo_prob=0.15)
    return s


def label_urgency(intent: str, sentence: str) -> int:
    s = sentence.lower()
    has_urgent = any(k in s for k in URGENT_KEYWORDS)
    if intent in ["DANGER", "MEDIC", "DISASTER"]:
        return 3 if (has_urgent or random.random() < 0.6) else 2
    if intent == "EVAC":
        return 3 if (has_urgent or random.random() < 0.5) else 2
    if intent in ["WATER", "SHELTER", "FOOD", "SICKNESS"]:
        return 2 if (has_urgent or random.random() < 0.3) else 1
    if intent == "INFO":
        return 1 if random.random() < 0.8 else 2
    return 0


def _extract_count(norm: str) -> int:
    m = re.search(r"\b(\d{1,2})\b", norm)
    return int(m.group(1)) if m else 0


def _extract_location_token(norm: str) -> str:
    for place in PLACE_TOKENS:
        if place in norm:
            return place
    return "unknown"


def _needs_location(norm: str) -> bool:
    return not any(cue in norm for cue in LOC_CUES)


def _needs_confirmation(intent: str) -> bool:
    return intent in CONFIRM_INTENTS


def make_dataset(
    n_per_intent: int = 250,
    n_normal: int = 2000,
    seed: int = 7,
) -> pd.DataFrame:
    """
    Generate synthetic dataset with text, is_vital, intent, urgency, and optional fields.
    """
    random.seed(seed)
    rows = []

    # Vital intents
    for intent in VITAL_INTENTS:
        for _ in range(n_per_intent):
            sent = sample_sentence(intent)
            urg = label_urgency(intent, sent)
            norm = sent.lower()
            rows.append({
                "text": sent,
                "is_vital": True,
                "intent": intent,
                "urgency": urg,
                "needs_location": _needs_location(norm),
                "needs_confirmation": _needs_confirmation(intent),
                "count": _extract_count(norm),
                "location_token": _extract_location_token(norm),
            })

    # CHAT intent (non-vital)
    for _ in range(n_per_intent):
        sent = sample_sentence("CHAT")
        norm = sent.lower()
        rows.append({
            "text": sent,
            "is_vital": False,
            "intent": "CHAT",
            "urgency": 0,
            "needs_location": False,
            "needs_confirmation": False,
            "count": _extract_count(norm),
            "location_token": _extract_location_token(norm),
        })

    # Extra normal (diverse chat / adversarial)
    for _ in range(n_normal):
        sent = sample_normal_sentence()
        norm = sent.lower()
        rows.append({
            "text": sent,
            "is_vital": False,
            "intent": "CHAT",
            "urgency": 0,
            "needs_location": False,
            "needs_confirmation": False,
            "count": _extract_count(norm),
            "location_token": "unknown",
        })

    random.shuffle(rows)
    return pd.DataFrame(rows)
