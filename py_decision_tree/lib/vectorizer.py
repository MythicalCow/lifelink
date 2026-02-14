"""
Text-to-vector encoding for decision tree input.
82 dims: 8 structure + 10 keyword buckets + 64 hashed char 4-grams.
"""
import re

import numpy as np

from .data_gen import BUCKETS, INTENTS, LOC_WORDS, TIME_WORDS

FEATURE_DIM = 82  # 8 structure + len(INTENTS) buckets + 64 ngrams
STRUCTURE_DIM = 8
NGRAM_BINS = 64
NGRAM_START = STRUCTURE_DIM + len(INTENTS)  # 18


def normalize_text(text: str) -> str:
    t = text.lower()
    t = re.sub(r"[^a-z0-9\s]", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def fnv1a_32(s: str) -> int:
    h = 0x811C9DC5
    for ch in s.encode("utf-8"):
        h ^= ch
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def build_vector(text: str, ngram_bins: int = NGRAM_BINS, ngram_n: int = 4) -> np.ndarray:
    """
    Map text to FEATURE_DIM float vector for decision tree input.
    """
    raw = text
    norm = normalize_text(raw)
    words = norm.split() if norm else []

    x = np.zeros(FEATURE_DIM, dtype=np.float32)

    # Structure features (0..7)
    len_chars = len(norm)
    len_words = len(words)
    num_digits = sum(c.isdigit() for c in raw)
    has_excl = 1.0 if "!" in raw else 0.0
    has_q = 1.0 if "?" in raw else 0.0

    letters = [c for c in raw if c.isalpha()]
    caps = [c for c in letters if c.isupper()]
    caps_ratio = (len(caps) / len(letters)) if letters else 0.0

    has_time = 1.0 if any(w in norm.split() for w in TIME_WORDS) else 0.0
    has_loc = 1.0 if any(kw in norm for kw in LOC_WORDS) else 0.0

    x[0] = min(len_words, 50) / 50.0
    x[1] = min(len_chars, 200) / 200.0
    x[2] = min(num_digits, 20) / 20.0
    x[3] = has_excl
    x[4] = has_q
    x[5] = min(caps_ratio * 10.0, 1.0)
    x[6] = has_time
    x[7] = has_loc

    # Keyword bucket counts (8..NGRAM_START-1)
    for bi, intent in enumerate(INTENTS):
        score = 0
        for kw in BUCKETS[intent]:
            if kw in norm:
                score += 1
        x[STRUCTURE_DIM + bi] = score

    # Hashed char 4-grams (NGRAM_START .. FEATURE_DIM-1)
    padded = " " + norm + " "
    for i in range(max(0, len(padded) - ngram_n + 1)):
        gram = padded[i : i + ngram_n]
        if gram.strip() == "":
            continue
        b = fnv1a_32(gram) % ngram_bins
        x[NGRAM_START + b] += 1.0

    x[NGRAM_START:] = np.clip(x[NGRAM_START:], 0, 15) / 15.0
    return x
