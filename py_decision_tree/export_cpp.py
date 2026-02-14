"""
Export sklearn DecisionTree models to C++ for ESP32.
Array-based traversal: feature index, threshold, left/right child, leaf class.
"""
import numpy as np
from sklearn.tree import DecisionTreeClassifier

# Sentinel for internal nodes in leaf_value array (255 = no leaf)
LEAF_SENTINEL = 255


def _tree_to_arrays(clf: DecisionTreeClassifier):
    """Extract parallel arrays from sklearn tree. Leaf class = argmax of value."""
    t = clf.tree_
    n = t.node_count
    feature = np.array(t.feature, dtype=np.int16)
    threshold = np.array(t.threshold, dtype=np.float32)
    left = np.array(t.children_left, dtype=np.int16)
    right = np.array(t.children_right, dtype=np.int16)
    # Leaf class: for leaves use argmax of value; for internal nodes use LEAF_SENTINEL
    leaf_value = np.full(n, LEAF_SENTINEL, dtype=np.uint8)
    for i in range(n):
        if t.children_left[i] == -1:  # leaf
            leaf_value[i] = np.argmax(t.value[i][0])
    return feature, threshold, left, right, leaf_value


def _emit_cpp_arrays(name_prefix: str, feature, threshold, left, right, leaf_value) -> str:
    n = len(feature)
    lines = [
        f"// {name_prefix}: {n} nodes",
        f"const int16_t {name_prefix}_feature[] = {{",
        "  " + ", ".join(str(int(feature[i])) for i in range(n)) + "\n};",
        f"const float {name_prefix}_threshold[] = {{",
        "  " + ", ".join(f"{float(threshold[i]):.6g}" for i in range(n)) + "\n};",
        f"const int16_t {name_prefix}_left[] = {{",
        "  " + ", ".join(str(int(left[i])) for i in range(n)) + "\n};",
        f"const int16_t {name_prefix}_right[] = {{",
        "  " + ", ".join(str(int(right[i])) for i in range(n)) + "\n};",
        f"const uint8_t {name_prefix}_leaf[] = {{",
        "  " + ", ".join(str(int(leaf_value[i])) for i in range(n)) + "\n};",
    ]
    return "\n".join(lines)


def _emit_traverse_function(name_prefix: str, n_features: int = 82) -> str:
    return f"""
int8_t {name_prefix}_predict(const float* x) {{
  int16_t node = 0;
  while (1) {{
    if ({name_prefix}_leaf[node] != {LEAF_SENTINEL})
      return (int8_t){name_prefix}_leaf[node];
    int16_t f = {name_prefix}_feature[node];
    if (f < 0 || f >= {n_features}) return -1;
    if (x[f] <= {name_prefix}_threshold[node])
      node = {name_prefix}_left[node];
    else
      node = {name_prefix}_right[node];
  }}
}}
"""


def export_tree_cpp(
    clf: DecisionTreeClassifier,
    name_prefix: str,
    n_features: int = 82,
) -> str:
    """Return C++ code for one tree (arrays + predict function)."""
    feature, threshold, left, right, leaf_value = _tree_to_arrays(clf)
    arrays = _emit_cpp_arrays(name_prefix, feature, threshold, left, right, leaf_value)
    traverse = _emit_traverse_function(name_prefix, n_features)
    return arrays + "\n" + traverse


def tree_stats(clf: DecisionTreeClassifier) -> dict:
    t = clf.tree_
    depth = 0
    stack = [(0, 0)]
    while stack:
        node, d = stack.pop()
        depth = max(depth, d)
        if t.children_left[node] != -1:
            stack.append((t.children_left[node], d + 1))
            stack.append((t.children_right[node], d + 1))
    n = t.node_count
    # Rough storage: feature 2B, threshold 4B, left 2B, right 2B, leaf 1B = 11B per node
    bytes_per_node = 2 + 4 + 2 + 2 + 1
    return {
        "node_count": n,
        "max_depth": depth,
        "estimated_bytes": n * bytes_per_node,
    }


def export_all_trees(
    vital_clf: DecisionTreeClassifier,
    intent_clf: DecisionTreeClassifier | None,
    urg_clf: DecisionTreeClassifier | None,
    n_features: int = 82,
) -> str:
    """Export vital gate + intent + urgency trees to a single C++ snippet."""
    parts = [
        "// Auto-generated decision tree inference for ESP32",
        "#include <stdint.h>",
        "",
    ]
    for name, clf in [("vital", vital_clf), ("intent", intent_clf), ("urgency", urg_clf)]:
        if clf is None:
            continue
        parts.append(export_tree_cpp(clf, name, n_features))
        parts.append("")
        stats = tree_stats(clf)
        parts.append(f"// {name}: nodes={stats['node_count']} depth={stats['max_depth']} ~{stats['estimated_bytes']} bytes")
        parts.append("")

    return "\n".join(parts)


if __name__ == "__main__":
    from lib.train import main

    vital_clf, intent_clf, urg_clf = main(n_per_intent=200, n_normal=1500)
    cpp = export_all_trees(vital_clf, intent_clf, urg_clf)
    print(cpp)
