"""Tests du modèle GPT : formes, sur-apprentissage d'un lot, génération.

Le test d'apprentissage est le critère essentiel d'un « vrai » LLM :
sur un unique lot répété, la perte doit s'effondrer (le modèle mémorise
par descente de gradient, aucune réponse n'est codée en dur).

Lançable : python tests/test_model.py   (ou via pytest)
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from nexus_llm.model import GPT, GPTConfig  # noqa: E402
from nexus_llm.optim import Adam, clip_grad_norm  # noqa: E402


def test_shapes():
    cfg = GPTConfig(vocab_size=97, block_size=32, n_layer=2, n_embd=64, n_head=4)
    model = GPT(cfg, seed=0)
    x = np.random.default_rng(0).integers(0, 97, size=(3, 32))
    logits = model.forward(x)
    assert logits.shape == (3, 32, 97), logits.shape
    # Garde-fou NEP 50 : aucun scalaire np.float64 ne doit promouvoir le
    # calcul en float64 (mémoire/temps doublés — piège déjà rencontré).
    assert logits.data.dtype == np.float32, logits.data.dtype
    print(f"formes OK : logits {logits.shape}, paramètres {model.num_params():,}")


def test_overfit_one_batch():
    rng = np.random.default_rng(1)
    cfg = GPTConfig(vocab_size=97, block_size=32, n_layer=2, n_embd=64, n_head=4)
    model = GPT(cfg, seed=0)
    opt = Adam(model.params())
    x = rng.integers(0, 97, size=(8, 32)).astype(np.int64)
    y = np.roll(x, -1, axis=1)
    first = last = None
    for step in range(60):
        model.zero_grad()
        loss = model.loss(x, y)
        loss.backward()
        clip_grad_norm(model.params(), 1.0)
        opt.step(5e-3)
        if first is None:
            first = float(loss.data)
        last = float(loss.data)
    print(f"sur-apprentissage : perte {first:.3f} -> {last:.3f} en 60 étapes")
    assert last < first * 0.5, "la perte doit chuter nettement (apprentissage réel)"


def test_generate():
    cfg = GPTConfig(vocab_size=97, block_size=32, n_layer=2, n_embd=64, n_head=4)
    model = GPT(cfg, seed=0)
    out = model.generate([1, 2, 3], max_new_tokens=10, rng=np.random.default_rng(0))
    assert len(out) == 10 and all(0 <= t < 97 for t in out)
    greedy = model.generate([1, 2, 3], max_new_tokens=5, temperature=0.0)
    greedy2 = model.generate([1, 2, 3], max_new_tokens=5, temperature=0.0)
    assert greedy == greedy2, "le mode glouton doit être déterministe"
    print(f"génération OK : {out} ; glouton déterministe OK")


if __name__ == "__main__":
    test_shapes()
    test_overfit_one_batch()
    test_generate()
    print("OK — modèle vérifié")
