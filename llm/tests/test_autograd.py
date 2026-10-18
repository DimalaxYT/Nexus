"""Vérification numérique des gradients du moteur autograd.

Compare les gradients analytiques (rétropropagation) aux différences finies
centrées sur un graphe combinant matmul, layernorm, softmax, embedding et
cross-entropy, en float64. C'est la preuve que la rétropropagation — donc
l'apprentissage du modèle — est mathématiquement correcte.

Lançable : python tests/test_autograd.py   (ou via pytest)
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from nexus_llm.autograd import Tensor, cross_entropy, embedding, layernorm, matmul, softmax, tsum  # noqa: E402


def build_loss(params, x, ids, targets):
    w, ln_w, ln_b, emb = params
    h = layernorm(matmul(x, w), ln_w, ln_b)
    h = h + embedding(emb, ids)
    probs = softmax(h)
    weighted = (probs * Tensor(np.array([0.3, -0.7, 1.1, 0.9, -0.2]), requires_grad=False)).reshape(4, 5)
    ce = cross_entropy(h.reshape(4, 5), targets)
    total = ce + tsum(weighted * weighted) * 0.01
    return total


def test_gradients():
    rng = np.random.default_rng(0)
    x = Tensor(rng.normal(size=(4, 5)))
    params = [
        Tensor(rng.normal(size=(5, 5)) * 0.5),
        Tensor(rng.normal(size=5)),
        Tensor(rng.normal(size=5)),
        Tensor(rng.normal(size=(7, 5)) * 0.5),
    ]
    ids = np.array([0, 2, 5, 5])
    targets = np.array([1, 0, 3, 2])

    loss = build_loss(params, x, ids, targets)
    loss.backward()

    tensors = [x] + params
    eps = 1e-6
    max_err = 0.0
    for t in tensors:
        it = np.nditer(t.data, flags=["multi_index"])
        while not it.finished:
            idx = it.multi_index
            orig = t.data[idx]
            t.data[idx] = orig + eps
            lp = float(build_loss(params, x, ids, targets).data)
            t.data[idx] = orig - eps
            lm = float(build_loss(params, x, ids, targets).data)
            t.data[idx] = orig
            numeric = (lp - lm) / (2 * eps)
            max_err = max(max_err, abs(numeric - t.grad[idx]))
            it.iternext()
    print(f"erreur max gradient analytique vs numérique : {max_err:.3e}")
    assert max_err < 1e-6, f"gradient incorrect : {max_err}"


def test_gradients_primitives():
    """Vérifie aussi les primitives fusionnées : attention et GELU."""
    from nexus_llm.autograd import attention, gelu

    rng = np.random.default_rng(7)
    q = Tensor(rng.normal(size=(2, 2, 4, 3)) * 0.5)
    k = Tensor(rng.normal(size=(2, 2, 4, 3)) * 0.5)
    v = Tensor(rng.normal(size=(2, 2, 4, 3)) * 0.5)
    g = Tensor(rng.normal(size=(3, 4)) * 0.5)
    mask = np.where(np.tril(np.ones((4, 4), dtype=bool)), 0.0, -1e9)[None, None]

    def build():
        out = attention(q, k, v, mask)
        w = Tensor(np.array([0.4, -0.9, 1.3]), requires_grad=False)
        return tsum(out * w) + tsum(gelu(g) * gelu(g)) * 0.1

    loss = build()
    loss.backward()
    eps, max_err = 1e-6, 0.0
    for t in (q, k, v, g):
        it = np.nditer(t.data, flags=["multi_index"])
        while not it.finished:
            idx = it.multi_index
            orig = t.data[idx]
            t.data[idx] = orig + eps
            lp = float(build().data)
            t.data[idx] = orig - eps
            lm = float(build().data)
            t.data[idx] = orig
            max_err = max(max_err, abs((lp - lm) / (2 * eps) - t.grad[idx]))
            it.iternext()
    print(f"erreur max gradients attention+GELU : {max_err:.3e}")
    assert max_err < 1e-6, f"gradient de primitive incorrect : {max_err}"


def test_label_smoothing_gradient():
    """Le gradient de la cross-entropy lissée doit aussi être exact."""
    rng = np.random.default_rng(11)
    logits = Tensor(rng.normal(size=(5, 7)))
    targets = np.array([0, 3, 6, 2, 5])

    def build():
        return cross_entropy(logits, targets, smoothing=0.1)

    build().backward()
    eps, max_err = 1e-6, 0.0
    it = np.nditer(logits.data, flags=["multi_index"])
    while not it.finished:
        idx = it.multi_index
        orig = logits.data[idx]
        logits.data[idx] = orig + eps
        lp = float(build().data)
        logits.data[idx] = orig - eps
        lm = float(build().data)
        logits.data[idx] = orig
        max_err = max(max_err, abs((lp - lm) / (2 * eps) - logits.grad[idx]))
        it.iternext()
    print(f"erreur max gradient cross-entropy lissée (ε=0,1) : {max_err:.3e}")
    assert max_err < 1e-6


if __name__ == "__main__":
    test_gradients()
    test_gradients_primitives()
    test_label_smoothing_gradient()
    print("OK — rétropropagation vérifiée")
