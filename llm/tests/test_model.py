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


def test_kv_cache_equivalence():
    """Le décodage avec cache KV doit donner les mêmes logits que le
    forward complet (c'est un changement d'implémentation, pas de maths)."""
    cfg = GPTConfig(vocab_size=97, block_size=32, n_layer=2, n_embd=64, n_head=4)
    model = GPT(cfg, seed=3)
    ids = np.random.default_rng(5).integers(0, 97, size=(1, 14)).astype(np.int64)
    full = model.forward(ids).data
    logits, cache = model.forward_np(ids[:, :6])  # pré-remplissage
    assert np.allclose(logits, full[:, :6], atol=1e-4), "préfixe divergent"
    for t in range(6, 14):  # décodage token par token avec cache
        logits, cache = model.forward_np(ids[:, t:t + 1], cache)
        assert np.allclose(logits[0, -1], full[0, t], atol=1e-4), f"token {t} divergent"
    print("cache KV : logits identiques au forward complet (préfixe + token par token)")


def test_sampling_filters():
    from nexus_llm.model import filter_logits

    logits = np.array([2.0, 1.0, 0.0, -1.0])
    greedy = filter_logits(logits, temperature=0.0)
    assert greedy[0] == 1.0 and greedy.sum() == 1.0
    plain = filter_logits(logits, seen_ids=[0], temperature=1.0, top_k=0, top_p=1.0)
    penalized = filter_logits(logits, seen_ids=[0], temperature=1.0, top_k=0,
                              top_p=1.0, repetition_penalty=2.0)
    assert penalized[0] < plain[0], "la pénalité doit réduire le token déjà émis"
    topk = filter_logits(logits, temperature=1.0, top_k=2, top_p=1.0)
    assert topk[2] == 0 and topk[3] == 0 and abs(topk.sum() - 1.0) < 1e-9
    print("filtres : glouton, pénalité de répétition, top-k OK")


def test_dropout_modes():
    """Évaluation : déterministe (et identique à forward_np). Entraînement :
    les masques changent la sortie, et le gradient traverse."""
    cfg = GPTConfig(vocab_size=97, block_size=32, n_layer=2, n_embd=64, n_head=4,
                    dropout=0.3)
    model = GPT(cfg, seed=3)
    ids = np.random.default_rng(5).integers(0, 97, size=(2, 16)).astype(np.int64)
    a = model.forward(ids).data
    b = model.forward(ids).data
    assert np.array_equal(a, b), "le mode éval doit être déterministe"
    np_logits, _ = model.forward_np(ids)
    assert np.allclose(a, np_logits, atol=1e-4), "éval autograd == éval NumPy"
    c = model.forward(ids, training=True).data
    assert not np.allclose(a, c), "le dropout doit modifier la sortie en entraînement"
    loss = model.loss(ids, np.roll(ids, -1, axis=1), training=True)
    loss.backward()
    assert all(p.grad is not None for p in model.params()), "gradients à travers le dropout"
    print("dropout : éval déterministe, entraînement masqué, gradient OK")


def test_beam_search_matches_greedy():
    """Faisceau de largeur 1 ≡ décodage glouton ; plus large = autre suite valide."""
    cfg = GPTConfig(vocab_size=97, block_size=32, n_layer=2, n_embd=64, n_head=4)
    model = GPT(cfg, seed=3)
    greedy = model.generate([4, 9, 2], max_new_tokens=12, temperature=0.0)
    beam1 = model.beam_search([4, 9, 2], beam_width=1, max_new_tokens=12)
    assert beam1 == greedy, f"faisceau 1 {beam1} != glouton {greedy}"
    beam4 = model.beam_search([4, 9, 2], beam_width=4, max_new_tokens=12)
    assert len(beam4) == 12 and all(0 <= t < 97 for t in beam4)
    print(f"beam search : largeur 1 == glouton {greedy[:5]}… ; largeur 4 valide")


if __name__ == "__main__":
    test_shapes()
    test_overfit_one_batch()
    test_generate()
    test_kv_cache_equivalence()
    test_sampling_filters()
    test_dropout_modes()
    test_beam_search_matches_greedy()
    print("OK — modèle vérifié")
