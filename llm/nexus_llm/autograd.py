"""Mini moteur d'autodifférentiation (mode inverse) sur tableaux NumPy.

C'est le cœur mathématique du LLM : chaque opération enregistre comment
propager le gradient vers ses entrées, puis `backward()` parcourt le graphe
en ordre topologique inverse pour calculer dL/d(paramètre) pour tous les
poids du Transformer. Aucun framework externe — uniquement NumPy.

Opérations fournies : matmul, add/mul (broadcasting), tanh, softmax,
layernorm, embedding (indexation), reshape, transpose, cross-entropy.
La correction des gradients est prouvée par `tests/test_autograd.py`
(comparaison aux différences finies, erreur < 1e-6 en float64).
"""
from __future__ import annotations

import numpy as np

_EMPTY = np.empty(0, dtype=np.float32)  # marqueur « données libérées » (partagé, jamais écrit)


def _NOOP() -> None:
    pass


def _unbroadcast(grad: np.ndarray, shape: tuple) -> np.ndarray:
    """Réduit `grad` à `shape` en sommant les axes diffusés (broadcast)."""
    while grad.ndim > len(shape):
        grad = grad.sum(axis=0)
    for i, dim in enumerate(shape):
        if dim == 1 and grad.shape[i] != 1:
            grad = grad.sum(axis=i, keepdims=True)
    return grad.reshape(shape)


class Tensor:
    """Un tableau NumPy + son gradient + l'historique pour la rétropropagation."""

    __slots__ = ("data", "grad", "requires_grad", "_prev", "_backward")

    def __init__(self, data, _children=(), requires_grad: bool = True):
        if isinstance(data, np.ndarray):
            self.data = data
        else:
            self.data = np.asarray(data, dtype=np.float64)
        self.requires_grad = requires_grad
        self.grad: np.ndarray | None = None
        self._prev = set(_children)
        self._backward = lambda: None

    # ------------------------------------------------------------------ util
    @property
    def shape(self) -> tuple:
        return self.data.shape

    def _accumulate(self, grad: np.ndarray) -> None:
        if not self.requires_grad:
            return
        grad = _unbroadcast(np.asarray(grad), self.data.shape)
        if self.grad is None:
            self.grad = np.array(grad, copy=True)
        else:
            self.grad = self.grad + grad

    def zero_grad(self) -> None:
        self.grad = None

    def backward(self) -> None:
        """Rétropropagation depuis ce tenseur (scalaire) vers toutes les feuilles."""
        topo: list[Tensor] = []
        visited: set[int] = set()
        stack: list[tuple[Tensor, bool]] = [(self, False)]
        while stack:  # ordre topologique itératif (pas de limite de récursion)
            node, expanded = stack.pop()
            if expanded:
                topo.append(node)
                continue
            if id(node) in visited:
                continue
            visited.add(id(node))
            stack.append((node, True))
            for child in node._prev:
                stack.append((child, False))
        self.grad = np.ones_like(self.data)
        for node in reversed(topo):
            node._backward()
            if node is not self and node._prev:
                # Intermédiaire déjà consommé : on libère gradient ET données
                # (les fermetures ont capturé les tableaux dont elles ont
                # besoin ; les paramètres sont des feuilles, jamais libérés).
                # On casse aussi le cycle nœud <-> fermeture : la libération
                # devient immédiate (refcounting) au lieu d'attendre le GC.
                node.grad = None
                node.data = _EMPTY
                node._prev = set()
                node._backward = _NOOP

    # ------------------------------------------------------------- opérateurs
    def __add__(self, other):
        return add(self, _wrap(other, self.data.dtype))

    def __radd__(self, other):
        return add(_wrap(other, self.data.dtype), self)

    def __mul__(self, other):
        return mul(self, _wrap(other, self.data.dtype))

    def __rmul__(self, other):
        return mul(_wrap(other, self.data.dtype), self)

    def __neg__(self):
        return mul(self, _wrap(-1.0, self.data.dtype))

    def __sub__(self, other):
        return add(self, -_wrap(other, self.data.dtype))

    def __matmul__(self, other):
        return matmul(self, _wrap(other))

    def reshape(self, *shape):
        return reshape(self, shape)

    def transpose(self, *axes):
        return transpose(self, axes)

    def __repr__(self):  # pragma: no cover - débogage
        return f"Tensor(shape={self.data.shape}, dtype={self.data.dtype})"


def _wrap(value, dtype=None) -> Tensor:
    """Emballage d'une constante. Le dtype suit celui de l'opérande tensoriel :
    sans cela, un scalaire float64 promouvrait tout le calcul en float64
    (mémoire doublée, BLAS ralenti) — piège classique de NumPy 2 / NEP 50."""
    if isinstance(value, Tensor):
        return value
    arr = np.asarray(value)
    if dtype is not None and arr.dtype != dtype:
        arr = arr.astype(dtype)
    return Tensor(arr, requires_grad=False)


# --------------------------------------------------------------------- ops
def add(a: Tensor, b: Tensor) -> Tensor:
    out = Tensor(a.data + b.data, (a, b), a.requires_grad or b.requires_grad)

    def _backward():
        a._accumulate(out.grad)
        b._accumulate(out.grad)

    out._backward = _backward
    return out


def mul(a: Tensor, b: Tensor) -> Tensor:
    out = Tensor(a.data * b.data, (a, b), a.requires_grad or b.requires_grad)

    def _backward():
        a._accumulate(out.grad * b.data)
        b._accumulate(out.grad * a.data)

    out._backward = _backward
    return out


def matmul(a: Tensor, b: Tensor) -> Tensor:
    out = Tensor(np.matmul(a.data, b.data), (a, b), a.requires_grad or b.requires_grad)

    def _backward():
        a._accumulate(np.matmul(out.grad, np.swapaxes(b.data, -1, -2)))
        b._accumulate(np.matmul(np.swapaxes(a.data, -1, -2), out.grad))

    out._backward = _backward
    return out


def tsum(a: Tensor, axis=None, keepdims: bool = False) -> Tensor:
    """Somme (réduction) ; le gradient est diffusé à la forme d'origine."""
    out = Tensor(a.data.sum(axis=axis, keepdims=keepdims), (a,), a.requires_grad)

    def _backward():
        g = out.grad
        if not keepdims and axis is not None:
            g = np.expand_dims(g, axis)
        a._accumulate(np.broadcast_to(g, a.data.shape))

    out._backward = _backward
    return out


def tanh(a: Tensor) -> Tensor:
    t = np.tanh(a.data)
    out = Tensor(t, (a,), a.requires_grad)

    def _backward():
        a._accumulate(out.grad * (1.0 - t * t))

    out._backward = _backward
    return out


def reshape(a: Tensor, shape) -> Tensor:
    if len(shape) == 1 and isinstance(shape[0], (tuple, list)):
        shape = tuple(shape[0])
    out = Tensor(a.data.reshape(shape), (a,), a.requires_grad)

    def _backward():
        a._accumulate(out.grad.reshape(a.data.shape))

    out._backward = _backward
    return out


def transpose(a: Tensor, axes) -> Tensor:
    if len(axes) == 1 and isinstance(axes[0], (tuple, list)):
        axes = tuple(axes[0])
    out = Tensor(np.transpose(a.data, axes), (a,), a.requires_grad)
    inv = tuple(np.argsort(axes))

    def _backward():
        a._accumulate(np.transpose(out.grad, inv))

    out._backward = _backward
    return out


def softmax(a: Tensor, axis: int = -1) -> Tensor:
    x = a.data - a.data.max(axis=axis, keepdims=True)  # stabilité numérique
    e = np.exp(x)
    s = e / e.sum(axis=axis, keepdims=True)
    out = Tensor(s, (a,), a.requires_grad)

    def _backward():
        dot = (out.grad * s).sum(axis=axis, keepdims=True)
        a._accumulate(s * (out.grad - dot))

    out._backward = _backward
    return out


def layernorm(a: Tensor, weight: Tensor, bias: Tensor, eps: float = 1e-5) -> Tensor:
    """LayerNorm sur le dernier axe : y = (x-μ)/√(σ²+ε) · w + b."""
    x = a.data
    mu = x.mean(axis=-1, keepdims=True)
    xc = x - mu
    var = (xc * xc).mean(axis=-1, keepdims=True)
    inv_std = 1.0 / np.sqrt(var + eps)
    xhat = xc * inv_std
    y = xhat * weight.data + bias.data
    out = Tensor(y, (a, weight, bias), True)

    def _backward():
        dy = out.grad
        n = x.shape[-1]
        lead = dy.reshape(-1, n)
        weight._accumulate((dy * xhat).reshape(-1, n).sum(axis=0))
        bias._accumulate(lead.sum(axis=0))
        dxhat = dy * weight.data
        dvar = (dxhat * xc * (-0.5) * inv_std**3).sum(axis=-1, keepdims=True)
        dmu = (dxhat * -inv_std).sum(axis=-1, keepdims=True) + dvar * (-2.0 * xc).mean(axis=-1, keepdims=True)
        dx = dxhat * inv_std + dvar * (2.0 * xc / n) + dmu / n
        a._accumulate(dx)

    out._backward = _backward
    return out


def embedding(weight: Tensor, ids: np.ndarray) -> Tensor:
    """Sélection de lignes : out = weight[ids] ; gradient via np.add.at."""
    out = Tensor(weight.data[ids], (weight,), True)

    def _backward():
        grad = np.zeros_like(weight.data)
        np.add.at(grad, ids, out.grad)
        weight._accumulate(grad)

    out._backward = _backward
    return out


def cross_entropy(logits: Tensor, targets: np.ndarray, smoothing: float = 0.0) -> Tensor:
    """Entropie croisée moyenne : logits (N, V), targets (N,) d'indices.

    smoothing > 0 : label smoothing — la cible devient (1-ε)·one-hot + ε/V.
    Régularise la confiance (utile quand le corpus est repassé plusieurs
    époques) ; gradient = (p − cible_lissée)/N. Calcul en float64 interne
    pour la stabilité du log, gradient ramené au dtype des logits."""
    z = logits.data.astype(np.float64)
    z = z - z.max(axis=-1, keepdims=True)
    e = np.exp(z)
    p = e / e.sum(axis=-1, keepdims=True)
    n, v = targets.shape[0], logits.data.shape[-1]
    logp = np.log(p + 1e-12)
    if smoothing > 0.0:
        loss = float(-((1.0 - smoothing) * logp[np.arange(n), targets]
                       + smoothing * logp.mean(axis=-1)).mean())
    else:
        loss = float(-logp[np.arange(n), targets].mean())
    out = Tensor(np.array(loss, dtype=np.float64), (logits,), True)

    def _backward():
        d = p.copy()
        d[np.arange(n), targets] -= (1.0 - smoothing)
        d -= smoothing / v
        d /= n
        logits._accumulate(d.astype(logits.data.dtype, copy=False))

    out._backward = _backward
    return out


def dropout(a: Tensor, p: float, rng: np.random.Generator) -> Tensor:
    """Dropout inversé : masque de Bernoulli tiré à chaque forward.

    Le masque est une constante du graphe (le gradient le traverse via
    `mul`) ; à l'évaluation, on n'appelle tout simplement pas cette
    fonction. p <= 0 -> identité (aucun tirage, coût nul)."""
    if p <= 0.0:
        return a
    keep = 1.0 - p
    mask = (rng.random(a.data.shape) < keep).astype(a.data.dtype, copy=False) / keep
    return mul(a, Tensor(mask, requires_grad=False))


def attention(q: Tensor, k: Tensor, v: Tensor, mask: np.ndarray) -> Tensor:
    """Attention à produit scalaire pondéré, en primitive fusionnée.

    q, k, v : (B, nh, T, hs) ; mask : tableau constant diffusible (0 / -1e9).
    On ne retient que P (probabilités) et q, k, v : les scores S sont
    recalculés implicitement au backward via P — principe « recompute »
    popularisé par FlashAttention, décisif pour la mémoire.
    """
    # float() Python obligatoire : un scalaire np.float64 promouvrait tout
    # le calcul en float64 (NEP 50) — mémoire et temps doublés.
    scale = float(1.0 / np.sqrt(q.data.shape[-1]))
    s = np.matmul(q.data, np.swapaxes(k.data, -1, -2)) * scale + mask
    s = s - s.max(axis=-1, keepdims=True)
    p = np.exp(s)
    p /= p.sum(axis=-1, keepdims=True)
    out = Tensor(np.matmul(p, v.data), (q, k, v), True)

    def _backward():
        do = out.grad
        dp = np.matmul(do, np.swapaxes(v.data, -1, -2))
        dv = np.matmul(np.swapaxes(p, -1, -2), do)
        ds = p * (dp - (dp * p).sum(axis=-1, keepdims=True)) * scale
        q._accumulate(np.matmul(ds, k.data))
        k._accumulate(np.matmul(np.swapaxes(ds, -1, -2), q.data))
        v._accumulate(dv)

    out._backward = _backward
    return out


def relu(a: Tensor) -> Tensor:
    """ReLU en primitive : y = max(x, 0) ; y' = 1{x>0} (recalculé, rien retenu).

    Choix délibéré plutôt que GELU : np.tanh est calculé en double précision
    interne et coûtait ~45 % du temps d'étape mesuré au profilage. ReLU est
    l'activation du Transformer originel (Vaswani et al., 2017)."""
    out = Tensor(np.maximum(a.data, 0), (a,), a.requires_grad)

    def _backward():
        a._accumulate(out.grad * (a.data > 0))

    out._backward = _backward
    return out


def gelu(a: Tensor) -> Tensor:
    """GELU (approximation tanh) en primitive : un seul tenseur retenu.

    y = ½x(1 + tanh(u)), u = √(2/π)(x + 0,044715x³)
    y' = ½(1 + tanh u) + ½x(1 − tanh²u)·√(2/π)(1 + 0,134145x²)
    tanh(u) est recalculé au backward plutôt que retenu (mémoire du MLP /2).
    Une version composée d'ops de base retiendrait ~9 intermédiaires.
    """
    c = 0.7978845608028654  # √(2/π)
    x = a.data
    t = np.tanh(c * (x + 0.044715 * x**3))
    out = Tensor(0.5 * x * (1.0 + t), (a,), a.requires_grad)

    def _backward():
        tt = np.tanh(c * (x + 0.044715 * x**3))
        du = c * (1.0 + 0.134145 * x * x)
        dy = 0.5 * (1.0 + tt) + 0.5 * x * (1.0 - tt * tt) * du
        a._accumulate(out.grad * dy)

    out._backward = _backward
    return out
