"""
Train is_vital gate, then intent/urgency models on vital subset.
Evaluation and confusion matrices.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.tree import DecisionTreeClassifier
from sklearn.metrics import (
    classification_report,
    accuracy_score,
    confusion_matrix,
)

from .data_gen import make_dataset, VITAL_INTENTS
from .vectorizer import build_vector


def main(
    n_per_intent: int = 250,
    n_normal: int = 2000,
    seed: int = 7,
    test_size: float = 0.25,
    test_seed: int | None = None,  # If set, generate test set with this seed (no train/test overlap).
    max_depth_vital: int = 6,
    max_depth_intent: int = 8,
    max_depth_urgency: int = 6,
):
    # Avoid data leakage: use separate seeds for train vs test so test set is
    # an independent draw (no sentence overlap). If test_seed is None, use random split.
    if test_seed is not None:
        df_train = make_dataset(n_per_intent=n_per_intent, n_normal=n_normal, seed=seed)
        df_test = make_dataset(n_per_intent=n_per_intent, n_normal=n_normal, seed=test_seed)
        X_train = np.vstack([build_vector(t) for t in df_train["text"].tolist()])
        X_test = np.vstack([build_vector(t) for t in df_test["text"].tolist()])
        yv_train = df_train["is_vital"].astype(int).values
        yv_test = df_test["is_vital"].astype(int).values
        yI_train = df_train["intent"].values
        yI_test = df_test["intent"].values
        yU_train = df_train["urgency"].values
        yU_test = df_test["urgency"].values
    else:
        df = make_dataset(n_per_intent=n_per_intent, n_normal=n_normal, seed=seed)
        X = np.vstack([build_vector(t) for t in df["text"].tolist()])
        y_vital = df["is_vital"].astype(int).values
        y_intent = df["intent"].values
        y_urg = df["urgency"].values
        X_train, X_test, yv_train, yv_test, yI_train, yI_test, yU_train, yU_test = train_test_split(
            X, y_vital, y_intent, y_urg,
            test_size=test_size,
            random_state=seed,
            stratify=y_vital,
        )

    # --- 1) is_vital gate (binary) ---
    vital_clf = DecisionTreeClassifier(max_depth=max_depth_vital, random_state=seed)
    vital_clf.fit(X_train, yv_train)
    pred_vital = vital_clf.predict(X_test)

    print("=== is_vital (gate) ===")
    print("Accuracy:", accuracy_score(yv_test, pred_vital))
    print(classification_report(yv_test, pred_vital, target_names=["normal", "vital"], digits=3))
    print("Confusion matrix:\n", confusion_matrix(yv_test, pred_vital))

    # --- 2) Intent and urgency on vital subset only ---
    vital_mask_train = yv_train == 1
    vital_mask_test = yv_test == 1

    if vital_mask_train.sum() == 0:
        print("No vital samples in train; skipping intent/urgency models.")
        return vital_clf, None, None

    X_train_vital = X_train[vital_mask_train]
    yI_train_v = yI_train[vital_mask_train]
    yU_train_v = yU_train[vital_mask_train]

    intent_clf = DecisionTreeClassifier(max_depth=max_depth_intent, random_state=seed)
    intent_clf.fit(X_train_vital, yI_train_v)

    urg_clf = DecisionTreeClassifier(max_depth=max_depth_urgency, random_state=seed)
    urg_clf.fit(X_train_vital, yU_train_v)

    # Evaluate intent/urgency on test vital subset
    if vital_mask_test.sum() > 0:
        X_test_vital = X_test[vital_mask_test]
        yI_test_v = yI_test[vital_mask_test]
        yU_test_v = yU_test[vital_mask_test]
        pred_I = intent_clf.predict(X_test_vital)
        pred_U = urg_clf.predict(X_test_vital)
        print("\n=== Intent (vital subset only) ===")
        print("Accuracy:", accuracy_score(yI_test_v, pred_I))
        print(classification_report(yI_test_v, pred_I, digits=3))
        print("Confusion matrix:\n", confusion_matrix(yI_test_v, pred_I))
        print("\n=== Urgency (vital subset only) ===")
        print("Accuracy:", accuracy_score(yU_test_v, pred_U))
        print(classification_report(yU_test_v, pred_U, digits=3))
        print("Confusion matrix:\n", confusion_matrix(yU_test_v, pred_U))

    return vital_clf, intent_clf, urg_clf


if __name__ == "__main__":
    vital_clf, intent_clf, urg_clf = main()
