"""
Inference wrapper and payload formatting.
- If not vital: return full ASCII message for LoRa.
- If vital: return compact schema payload (e.g. MEDIC|U3|F0|N2|Lbridge).
"""
import re

import numpy as np

from .data_gen import CONFIRM_INTENTS, LOC_CUES, PLACE_TOKENS
from .vectorizer import build_vector, normalize_text


def _needs_location(norm: str) -> bool:
    return not any(cue in norm for cue in LOC_CUES)


def _needs_confirmation(intent: str) -> bool:
    return intent in CONFIRM_INTENTS


def _extract_count(norm: str) -> int:
    m = re.search(r"\b(\d{1,2})\b", norm)
    return int(m.group(1)) if m else 0


def _extract_location_token(norm: str) -> str:
    for place in PLACE_TOKENS:
        if place in norm:
            return place
    return "unknown"


def format_vital_payload(
    intent: str,
    urgency: int,
    needs_location: bool,
    needs_confirmation: bool,
    count: int,
    location_token: str,
) -> str:
    """Build compact ASCII payload: INTENT|U{0-3}|F{flags}|N{count}|L{loc}."""
    flags = (1 if needs_location else 0) | ((1 if needs_confirmation else 0) << 1)
    return f"{intent}|U{urgency}|F{flags}|N{count}|L{location_token}"


def triage(
    text: str,
    vital_clf,
    intent_clf,
    urg_clf,
) -> tuple[bool, str | None]:
    """
    Run triage on text. Returns (is_vital, payload).
    - If is_vital is False: payload is None; send full ASCII `text` over LoRa.
    - If is_vital is True: payload is compact string; send payload over LoRa.
    """
    x = build_vector(text).reshape(1, -1)
    is_vital = bool(vital_clf.predict(x)[0])

    if not is_vital:
        return False, None  # Send full ASCII message

    # Vital: get intent and urgency from trees (if available)
    intent = "INFO"  # default
    urgency = 2
    if intent_clf is not None:
        intent = intent_clf.predict(x)[0]
    if urg_clf is not None:
        urgency = int(urg_clf.predict(x)[0])

    norm = normalize_text(text)
    needs_location = _needs_location(norm)
    needs_confirmation = _needs_confirmation(intent)
    count = _extract_count(norm)
    location_token = _extract_location_token(norm)

    payload = format_vital_payload(
        intent=intent,
        urgency=urgency,
        needs_location=needs_location,
        needs_confirmation=needs_confirmation,
        count=count,
        location_token=location_token,
    )
    return True, payload


def run_inference_examples(vital_clf, intent_clf, urg_clf, sentences: list[str]) -> None:
    """Print triage result for each sentence."""
    for s in sentences:
        is_vital, payload = triage(s, vital_clf, intent_clf, urg_clf)
        if is_vital:
            print(f"  VITAL -> {payload}")
        else:
            print(f"  NORMAL -> (send full ASCII): {s[:50]}{'...' if len(s) > 50 else ''}")
