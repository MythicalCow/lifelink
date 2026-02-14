"""
LoRa Mesh AI Triage MVP (TreeHacks) — demo script.
Uses: lib (data_gen, vectorizer, train, infer), export_cpp.
Primary gate: is_vital. If vital -> compact payload; if normal -> full ASCII.
"""
from lib.train import main as train_main
from lib.infer import triage
from export_cpp import export_all_trees, tree_stats

# --- Train pipeline ---
print("Training is_vital gate + intent/urgency on vital subset...\n")
vital_clf, intent_clf, urg_clf = train_main(
    n_per_intent=250,
    n_normal=2000,
    seed=7,
    test_size=0.25,
    max_depth_vital=6,
    max_depth_intent=8,
    max_depth_urgency=6,
)

# --- Model size summary ---
print("\n=== Model size (for ESP32) ===")
for name, clf in [("vital", vital_clf), ("intent", intent_clf), ("urgency", urg_clf)]:
    if clf is not None:
        s = tree_stats(clf)
        print(f"  {name}: nodes={s['node_count']} depth={s['max_depth']} ~{s['estimated_bytes']} B")

# --- Inference examples ---
TESTS = [
    "Need a medic for 2 injured people near the bridge ASAP!",
    "we are out of clean water at camp please",
    "shots fired behind the market urgent",
    "any update near the library?",
    "lol ok see you at camp",
    "need a place to sleep tonight",
    "that movie was fire",
    "medic we need more snacks",
]

print("\n=== Triage examples ===")
for t in TESTS:
    is_vital, payload = triage(t, vital_clf, intent_clf, urg_clf)
    print(t)
    if is_vital:
        print("  -> VITAL:", payload)
    else:
        print("  -> NORMAL (send full ASCII)")
    print()

# --- Optional: print C++ export snippet (first 80 lines) ---
# cpp = export_all_trees(vital_clf, intent_clf, urg_clf)
# print("=== C++ export (preview) ===\n")
# print("\n".join(cpp.splitlines()[:80]))
