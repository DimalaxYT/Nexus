"""Architecture GPT (Transformer décodeur) en NumPy, via notre autograd.

Décodeur causal « pre-norm » classique (Vaswani et al. 2017 ; Radford et al. 2018) :
  token+position embeddings → N × [ LayerNorm → attention causale multi-têtes
  → résidu → LayerNorm → MLP(GELU) → résidu ] → LayerNorm → tête de sortie.
La tête de sortie partage ses poids avec l'embedding (weight tying).
Initialisation gaussienne 0,02 ; projections résiduelles réduites en
1/√(2·n_layer) (comme GPT-2) pour stabiliser l'entraînement profond.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

from .autograd import Tensor, attention, cross_entropy, embedding, layernorm, matmul, relu, transpose


@dataclass
class GPTConfig:
    vocab_size: int
    block_size: int = 256
    n_layer: int = 6
    n_embd: int = 256
    n_head: int = 8

    def __post_init__(self):
        assert self.n_embd % self.n_head == 0, "n_embd doit être divisible par n_head"


class _Layer:
    """Poids d'un bloc Transformer (conteneurs simples, pas de logique)."""

    def __init__(self, rng: np.random.Generator, c: GPTConfig, resid_std: float):
        n = c.n_embd
        rn = lambda *s, std=0.02: Tensor(rng.normal(0, std, s).astype(np.float32))  # noqa: E731
        z = lambda *s: Tensor(np.zeros(s, dtype=np.float32))  # noqa: E731
        o = lambda *s: Tensor(np.ones(s, dtype=np.float32))  # noqa: E731
        self.ln1_w, self.ln1_b = o(n), z(n)
        self.wq, self.wk, self.wv = rn(n, n), rn(n, n), rn(n, n)
        self.bq, self.bk, self.bv = z(n), z(n), z(n)
        self.wo, self.bo = rn(n, n, std=resid_std), z(n)
        self.ln2_w, self.ln2_b = o(n), z(n)
        self.w1, self.b1 = rn(n, 4 * n), z(4 * n)
        self.w2, self.b2 = rn(4 * n, n, std=resid_std), z(n)

    def params(self) -> list[Tensor]:
        return [v for v in vars(self).values() if isinstance(v, Tensor)]


class GPT:
    def __init__(self, config: GPTConfig, seed: int = 42):
        self.config = config
        rng = np.random.default_rng(seed)
        c = config
        rn = lambda *s, std=0.02: Tensor(rng.normal(0, std, s).astype(np.float32))  # noqa: E731
        self.wte = rn(c.vocab_size, c.n_embd)
        self.wpe = rn(c.block_size, c.n_embd)
        resid_std = 0.02 / np.sqrt(2 * c.n_layer)
        self.layers = [_Layer(rng, c, resid_std) for _ in range(c.n_layer)]
        self.lnf_w = Tensor(np.ones(c.n_embd, dtype=np.float32))
        self.lnf_b = Tensor(np.zeros(c.n_embd, dtype=np.float32))

    # ---------------------------------------------------------------- poids
    def params(self) -> list[Tensor]:
        out = [self.wte, self.wpe]
        for layer in self.layers:
            out.extend(layer.params())
        out.extend([self.lnf_w, self.lnf_b])
        return out

    def num_params(self) -> int:
        return int(sum(p.data.size for p in self.params()))

    def zero_grad(self) -> None:
        for p in self.params():
            p.zero_grad()

    # ---------------------------------------------------------------- forward
    def forward(self, ids: np.ndarray) -> Tensor:
        """ids (B, T) int → logits (B, T, vocab) via le graphe autograd."""
        c = self.config
        _, t = ids.shape
        x = embedding(self.wte, ids) + embedding(self.wpe, np.arange(t))
        mask = _causal_mask(t, x.data.dtype)
        for layer in self.layers:
            x = x + self._attention(layernorm(x, layer.ln1_w, layer.ln1_b), layer, mask)
            x = x + self._mlp(layernorm(x, layer.ln2_w, layer.ln2_b), layer)
        x = layernorm(x, self.lnf_w, self.lnf_b)
        return matmul(x, transpose(self.wte, (1, 0)))  # poids liés

    def _attention(self, x: Tensor, layer: _Layer, mask: Tensor) -> Tensor:
        c = self.config
        b, t, n = x.shape
        nh, hs = c.n_head, n // c.n_head

        def heads(y: Tensor) -> Tensor:  # (B,T,C) -> (B,nh,T,hs)
            return transpose(y.reshape(b, t, nh, hs), (0, 2, 1, 3))

        q = heads(matmul(x, layer.wq) + layer.bq)
        k = heads(matmul(x, layer.wk) + layer.bk)
        v = heads(matmul(x, layer.wv) + layer.bv)
        y = transpose(attention(q, k, v, mask), (0, 2, 1, 3)).reshape(b, t, n)
        return matmul(y, layer.wo) + layer.bo

    @staticmethod
    def _mlp(x: Tensor, layer: _Layer) -> Tensor:
        return matmul(relu(matmul(x, layer.w1) + layer.b1), layer.w2) + layer.b2

    # ---------------------------------------------------------------- perte
    def loss(self, ids: np.ndarray, targets: np.ndarray) -> Tensor:
        logits = self.forward(ids)
        b, t, v = logits.shape
        return cross_entropy(logits.reshape(b * t, v), targets.reshape(b * t))

    # ------------------------------------------------------------- génération
    # ------------------------------------------------------------- inférence
    def forward_np(self, ids: np.ndarray, cache: list | None = None):
        """Forward NumPy pur (sans graphe autograd), avec cache KV optionnel.

        ids : (B, T_new) ; cache : liste par couche de (K, V) déjà calculés,
        chacun (B, nh, T_past, hs). Retourne (logits (B, T_new, vocab),
        nouveau cache). À mathématique identique avec `forward` (prouvé par
        test d'équivalence), mais chaque token décodé ne coûte qu'un pas :
        sans cache, générer N tokens coûtait N forwards complets.
        """
        c = self.config
        b, t = ids.shape
        past = 0 if cache is None else cache[0][0].shape[2]
        nh, hs = c.n_head, c.n_embd // c.n_head
        x = self.wte.data[ids] + self.wpe.data[past:past + t][None, :, :]
        new_cache: list = []
        scale = float(1.0 / np.sqrt(hs))
        for li, layer in enumerate(self.layers):
            h = _layernorm_np(x, layer.ln1_w.data, layer.ln1_b.data)
            q = (h @ layer.wq.data + layer.bq.data).reshape(b, t, nh, hs).transpose(0, 2, 1, 3)
            k = (h @ layer.wk.data + layer.bk.data).reshape(b, t, nh, hs).transpose(0, 2, 1, 3)
            v = (h @ layer.wv.data + layer.bv.data).reshape(b, t, nh, hs).transpose(0, 2, 1, 3)
            if cache is not None:
                k = np.concatenate([cache[li][0], k], axis=2)
                v = np.concatenate([cache[li][1], v], axis=2)
            new_cache.append((k, v))
            s = q @ k.transpose(0, 1, 3, 2) * scale
            qpos = np.arange(past, past + t)[:, None]
            kpos = np.arange(k.shape[2])[None, :]
            s = s + np.where(kpos <= qpos, 0.0, -1e9).astype(s.dtype)[None, None]
            p = np.exp(s - s.max(axis=-1, keepdims=True))
            p /= p.sum(axis=-1, keepdims=True)
            y = (p @ v).transpose(0, 2, 1, 3).reshape(b, t, c.n_embd)
            x = x + y @ layer.wo.data + layer.bo.data
            h2 = _layernorm_np(x, layer.ln2_w.data, layer.ln2_b.data)
            x = x + np.maximum(h2 @ layer.w1.data + layer.b1.data, 0.0) @ layer.w2.data + layer.b2.data
        x = _layernorm_np(x, self.lnf_w.data, self.lnf_b.data)
        return x @ self.wte.data.T, new_cache

    @np.errstate(all="ignore")
    def generate(self, prompt_ids: list[int], max_new_tokens: int = 100,
                 temperature: float = 0.9, top_k: int = 40, top_p: float = 0.95,
                 repetition_penalty: float = 1.0,
                 rng: np.random.Generator | None = None,
                 stop_at_eos: int | None = None) -> list[int]:
        """Échantillonnage auto-régressif avec cache KV (un pas par token).

        repetition_penalty > 1 (ex. 1,1) pénalise les tokens déjà émis :
        remède classique aux boucles dégénérées des petits modèles.
        Si le contexte dépasse block_size, le cache est reconstruit depuis
        la fenêtre récente (même sémantique que le recadrage historique).
        """
        rng = rng or np.random.default_rng()
        ids = list(prompt_ids[-self.config.block_size:])
        out: list[int] = []
        logits, cache = self.forward_np(np.array([ids], dtype=np.int64))
        for _ in range(max_new_tokens):
            nxt = _sample(logits[0, -1].astype(np.float64), temperature, top_k, top_p,
                          repetition_penalty, ids + out, rng)
            out.append(nxt)
            if stop_at_eos is not None and nxt == stop_at_eos:
                break
            if len(ids) + len(out) >= self.config.block_size:
                window = (ids + out)[-self.config.block_size:]
                logits, cache = self.forward_np(np.array([window], dtype=np.int64))
            else:
                logits, cache = self.forward_np(np.array([[nxt]], dtype=np.int64), cache)
        return out

    # ------------------------------------------------------------ persistance
    def save(self, path: str | Path, extra: dict | None = None) -> None:
        path = Path(path)
        arrays = {f"p{i}": p.data for i, p in enumerate(self.params())}
        np.savez(path, **arrays)
        meta = {"config": asdict(self.config), "num_params": self.num_params(), **(extra or {})}
        path.with_suffix(".json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    @classmethod
    def load(cls, path: str | Path) -> tuple["GPT", dict]:
        path = Path(path)
        meta = json.loads(path.with_suffix(".json").read_text(encoding="utf-8"))
        model = cls(GPTConfig(**meta["config"]), seed=0)
        with np.load(path) as data:
            for i, p in enumerate(model.params()):
                arr = data[f"p{i}"]
                assert arr.shape == p.data.shape, f"forme inattendue pour p{i}"
                p.data = arr.copy()
        return model, meta


def _causal_mask(t: int, dtype) -> np.ndarray:
    """0 sur/diag. inférieure, -1e9 au-dessus : aucun accès au futur."""
    mask = np.where(np.tril(np.ones((t, t), dtype=bool)), 0.0, -1e9).astype(dtype)
    return mask[None, None, :, :]


def _layernorm_np(x: np.ndarray, weight: np.ndarray, bias: np.ndarray,
                  eps: float = 1e-5) -> np.ndarray:
    """LayerNorm NumPy pur (miroir exact de la primitive autograd)."""
    mu = x.mean(axis=-1, keepdims=True)
    xc = x - mu
    var = (xc * xc).mean(axis=-1, keepdims=True)
    return xc / np.sqrt(var + eps) * weight + bias


def filter_logits(logits: np.ndarray, seen_ids: list[int] | tuple = (),
                  temperature: float = 0.9, top_k: int = 40, top_p: float = 0.95,
                  repetition_penalty: float = 1.0) -> np.ndarray:
    """Applique pénalité de répétition, température, top-k et top-p.

    Fonction pure (testable unitairement) : logits 1D -> probabilités 1D.
    Pénalité (style CTRL) : un logit déjà émis est divisé par le facteur
    s'il est positif, multiplié sinon — jamais d'interdiction dure.
    """
    logits = logits.astype(np.float64, copy=True)
    if repetition_penalty and repetition_penalty != 1.0:
        for tid in set(seen_ids):
            if 0 <= tid < logits.shape[0]:
                logits[tid] = (logits[tid] / repetition_penalty if logits[tid] > 0
                               else logits[tid] * repetition_penalty)
    if temperature <= 0:  # glouton : one-hot sur l'argmax
        probs = np.zeros_like(logits)
        probs[int(np.argmax(logits))] = 1.0
        return probs
    logits = logits / temperature
    if top_k and top_k > 0:
        kth = np.partition(logits, -top_k)[-top_k]
        logits = np.where(logits < kth, -np.inf, logits)
    probs = np.exp(logits - logits.max())
    probs /= probs.sum()
    if top_p and top_p < 1.0:  # nucleus sampling
        order = np.argsort(-probs)
        cum = np.cumsum(probs[order])
        keep = cum - probs[order] < top_p
        filtered = np.zeros_like(probs)
        filtered[order[keep]] = probs[order[keep]]
        probs = filtered / filtered.sum()
    return probs


def _sample(logits: np.ndarray, temperature: float, top_k: int, top_p: float,
            repetition_penalty: float, seen_ids: list[int],
            rng: np.random.Generator) -> int:
    probs = filter_logits(logits, seen_ids, temperature, top_k, top_p, repetition_penalty)
    return int(rng.choice(len(probs), p=probs))
