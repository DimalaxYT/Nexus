"""Tests de l'optimiseur : AdamW (décroissance découplée scopée) et plannings LR.

Lançable : python tests/test_optim.py   (ou via pytest)
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from nexus_llm.autograd import Tensor  # noqa: E402
from nexus_llm.optim import Adam, lr_at  # noqa: E402


def test_adamw_scoping():
    """Gradient nul : seul le paramètre « matrice » doit décroître (AdamW),
    le biais reste intact ; sans decay_ids, les deux décroissent (ancien mode)."""
    mat = Tensor(np.array([[1.0, -2.0]]))
    bias = Tensor(np.array([1.0, -2.0]))
    for p in (mat, bias):
        p.grad = np.zeros_like(p.data)
    opt = Adam([mat, bias], weight_decay=0.1, decay_ids={id(mat)})
    opt.step(lr=0.1)
    assert np.allclose(mat.data, [[0.99, -1.98]]), mat.data  # × (1 − lr·wd)
    assert np.allclose(bias.data, [1.0, -2.0]), bias.data    # épargné
    print("AdamW : décroissance découplée sur les matrices seulement")


def test_lr_schedules():
    assert lr_at(0, 100, 1.0, warmup=10) == 0.1                      # warmup linéaire
    assert lr_at(9, 100, 1.0, warmup=10) == 1.0
    assert lr_at(50, 100, 1.0, warmup=10) < lr_at(20, 100, 1.0, warmup=10)  # cosinus décroissant
    assert lr_at(99, 100, 1.0, warmup=10) >= 0.1 - 1e-9               # plancher min_ratio
    assert lr_at(50, 100, 0.5, warmup=10, schedule="constant") == 0.5
    lin = lr_at(55, 100, 1.0, warmup=10, schedule="linear")           # mi-parcours post-warmup
    assert abs(lin - 0.55) < 1e-9, lin
    print("plannings LR : warmup, cosinus, constant, linéaire OK")


if __name__ == "__main__":
    test_adamw_scoping()
    test_lr_schedules()
    print("OK — optimiseur vérifié")
