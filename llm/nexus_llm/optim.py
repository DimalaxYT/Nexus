"""Optimiseur Adam (Kingma & Ba, 2015) et planification du taux d'apprentissage.

Écrit de zéro : moments d'ordre 1 et 2, correction de biais, clipping global
de la norme du gradient, planning warmup linéaire + décroissance cosinus.
"""
from __future__ import annotations

import numpy as np

from .autograd import Tensor


def clip_grad_norm(params: list[Tensor], max_norm: float) -> float:
    total = 0.0
    for p in params:
        if p.grad is not None:
            total += float((p.grad.astype(np.float64) ** 2).sum())
    norm = float(np.sqrt(total))
    if norm > max_norm:
        scale = max_norm / (norm + 1e-6)
        for p in params:
            if p.grad is not None:
                p.grad = p.grad * np.float32(scale)
    return norm


class Adam:
    """Adam / AdamW. decay_ids : ids des paramètres soumis à la décroissance
    découplée (recette AdamW : p ← p·(1 − lr·wd) avant le pas Adam, et
    seulement sur les matrices — voir GPT.decay_param_ids). None = tous
    (ancien comportement). Moments m/v persistables par train.py."""

    def __init__(self, params: list[Tensor], beta1: float = 0.9, beta2: float = 0.95,
                 eps: float = 1e-8, weight_decay: float = 0.0,
                 decay_ids: set[int] | None = None):
        self.params = params
        self.beta1, self.beta2, self.eps = beta1, beta2, eps
        self.weight_decay = weight_decay
        self.decay_ids = decay_ids
        self.m = [np.zeros_like(p.data) for p in params]
        self.v = [np.zeros_like(p.data) for p in params]
        self.t = 0

    def step(self, lr: float) -> None:
        self.t += 1
        b1, b2 = self.beta1, self.beta2
        corr1 = 1.0 - b1 ** self.t
        corr2 = 1.0 - b2 ** self.t
        for i, p in enumerate(self.params):
            if p.grad is None:
                continue
            if self.weight_decay and (self.decay_ids is None or id(p) in self.decay_ids):
                p.data = (p.data * (1.0 - lr * self.weight_decay)).astype(p.data.dtype, copy=False)
            g = p.grad
            self.m[i] = b1 * self.m[i] + (1 - b1) * g
            self.v[i] = b2 * self.v[i] + (1 - b2) * (g * g)
            m_hat = self.m[i] / corr1
            v_hat = self.v[i] / corr2
            update = lr * m_hat / (np.sqrt(v_hat) + self.eps)
            p.data = (p.data - update).astype(p.data.dtype, copy=False)


def lr_at(step: int, total_steps: int, base_lr: float, warmup: int = 50,
          min_ratio: float = 0.1, schedule: str = "cosine") -> float:
    """Warmup linéaire, puis planning au choix :
    cosine (défaut, vers base_lr·min_ratio), constant (utile en affinage :
    petit LR stable), linear (décroissance linéaire vers base_lr·min_ratio)."""
    if step < warmup:
        return base_lr * (step + 1) / warmup
    if schedule == "constant":
        return base_lr
    progress = (step - warmup) / max(1, total_steps - warmup)
    progress = min(1.0, progress)
    if schedule == "linear":
        return base_lr * (1.0 - (1.0 - min_ratio) * progress)
    if schedule != "cosine":
        raise ValueError(f"planning inconnu : {schedule!r} (cosine|constant|linear)")
    cosine = 0.5 * (1.0 + np.cos(np.pi * progress))
    return base_lr * (min_ratio + (1 - min_ratio) * cosine)
