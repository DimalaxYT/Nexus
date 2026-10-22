"""Entraînement du modèle de conversation NEXUS (`nexus-chat-v2`), en NumPy.

Pourquoi ce trainer est en Python alors que l'inférence est en TypeScript :

  · l'autodifférentiation du dépôt (`llm/nexus_llm/autograd.py`) est ~20 à 30×
    plus rapide que la version TypeScript pour les mêmes tenseurs (mesuré :
    0,26 s/pas contre 8,9 s/pas à dim 128 / 4 couches / ctx 512 / lot 2) ;
  · l'entraînement est une opération HORS LIGNE, qui produit un fichier de poids
    versionné (`public/models/nexus-chat-v2.bin`) ; l'application, elle, reste
    100 % TypeScript et n'exécute jamais Python.

Le réseau est EXACTEMENT celui de `src/lib/llm/model.ts` : mêmes couches, même
GELU (approximation tanh), même LayerNorm, mêmes poids liés, même ordre de
paramètres (`paramList`). Un test de parité TypeScript recharge le fichier
exporté et compare les logits (voir `scripts/check-chat-model.ts`).

Deux phases, comme tout LLM :
  1. pré-entraînement linguistique sur de la prose française (prédiction du
     caractère suivant) — grammaire, orthographe, vocabulaire ;
  2. affinage sur le corpus `chat-v1` exporté par `scripts/export-chat-corpus.ts`
     (tâche : lire `C:` et `Q:`, écrire `R:`).

Usage :
  llm/.venv/bin/python llm/train_nexus_chat.py \
      --corpus llm/data/chat_corpus_v2.json \
      --pretrain llm/data/chat_pretrain_v2.txt \
      --pretrain-steps 700 --steps 2600 --batch 2 \
      --out public/models/nexus-chat-v2
"""
from __future__ import annotations

import argparse
import json
import math
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np

# Le trainer réutilise le moteur d'autograd du dépôt (aucune dépendance nouvelle).
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from nexus_llm.autograd import (Tensor, attention, cross_entropy, dropout,  # noqa: E402
                                embedding, gelu, layernorm, matmul, transpose)
from nexus_llm.tokenizer import BPETokenizer  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


# ────────────────────────────────────────────────────────────────────────────
# Modèle identique à src/lib/llm/model.ts
# ────────────────────────────────────────────────────────────────────────────


class Layer:
    def __init__(self, rng: np.random.Generator, dim: int, resid_std: float):
        def r(*shape, std=0.02):
            return Tensor(rng.normal(0, std, shape).astype(np.float32))

        self.ln1g = Tensor(np.ones(dim, dtype=np.float32))
        self.ln1b = Tensor(np.zeros(dim, dtype=np.float32))
        self.wq = r(dim, dim)
        self.wk = r(dim, dim)
        self.wv = r(dim, dim)
        self.wo = r(dim, dim, std=resid_std)
        self.ln2g = Tensor(np.ones(dim, dtype=np.float32))
        self.ln2b = Tensor(np.zeros(dim, dtype=np.float32))
        self.w1 = r(dim, 4 * dim)
        self.b1 = Tensor(np.zeros(4 * dim, dtype=np.float32))
        self.w2 = r(4 * dim, dim, std=resid_std)
        self.b2 = Tensor(np.zeros(dim, dtype=np.float32))

    def named_params(self) -> list[tuple[str, Tensor]]:
        # Ordre EXACT de paramList() côté TypeScript.
        return [
            ("ln1g", self.ln1g), ("ln1b", self.ln1b),
            ("wq", self.wq), ("wk", self.wk), ("wv", self.wv), ("wo", self.wo),
            ("ln2g", self.ln2g), ("ln2b", self.ln2b),
            ("w1", self.w1), ("b1", self.b1), ("w2", self.w2), ("b2", self.b2),
        ]


class ChatGPT:
    def __init__(self, cfg: dict, seed: int = 1337):
        self.cfg = cfg
        self.vocab = int(cfg["vocab"])
        self.ctx = int(cfg["ctx"])
        self.dim = int(cfg["dim"])
        self.heads = int(cfg["heads"])
        self.layers_n = int(cfg["layers"])
        rng = np.random.default_rng(seed)
        self.drop_rng = np.random.default_rng(seed + 1)
        resid = 0.02 / math.sqrt(2 * self.layers_n)
        self.wte = Tensor(rng.normal(0, 0.02, (self.vocab, self.dim)).astype(np.float32))
        self.wpe = Tensor(rng.normal(0, 0.02, (self.ctx, self.dim)).astype(np.float32))
        self.layers = [Layer(rng, self.dim, resid) for _ in range(self.layers_n)]
        self.lnfg = Tensor(np.ones(self.dim, dtype=np.float32))
        self.lnfb = Tensor(np.zeros(self.dim, dtype=np.float32))

    # ------------------------------------------------------------------ poids
    def named_params(self) -> list[tuple[str, Tensor]]:
        out: list[tuple[str, Tensor]] = [("tokEmb", self.wte), ("posEmb", self.wpe)]
        for i, layer in enumerate(self.layers):
            out.extend((f"layer{i}.{name}", p) for name, p in layer.named_params())
        out.extend([("lnfg", self.lnfg), ("lnfb", self.lnfb)])
        return out

    def params(self) -> list[Tensor]:
        return [p for _, p in self.named_params()]

    def num_params(self) -> int:
        return int(sum(p.data.size for p in self.params()))

    def zero_grad(self) -> None:
        for p in self.params():
            p.zero_grad()

    # ------------------------------------------------------------------ avant
    def forward(self, ids: np.ndarray, training: bool = False, dropout_p: float = 0.0) -> Tensor:
        b, t = ids.shape
        nh = self.heads
        hs = self.dim // nh
        x = embedding(self.wte, ids) + embedding(self.wpe, np.arange(t))
        if training and dropout_p > 0:
            x = dropout(x, dropout_p, self.drop_rng)
        mask = (1 - np.tril(np.ones((t, t), dtype=np.float32))) * -1e9
        for layer in self.layers:
            h = layernorm(x, layer.ln1g, layer.ln1b)

            def heads(y: Tensor) -> Tensor:  # (B,T,D) → (B,nh,T,hs)
                return transpose(y.reshape(b, t, nh, hs), (0, 2, 1, 3))

            q = heads(matmul(h, layer.wq))
            k = heads(matmul(h, layer.wk))
            v = heads(matmul(h, layer.wv))
            sub = matmul(transpose(attention(q, k, v, mask), (0, 2, 1, 3)).reshape(b, t, self.dim), layer.wo)
            if training and dropout_p > 0:
                sub = dropout(sub, dropout_p, self.drop_rng)
            x = x + sub
            h2 = layernorm(x, layer.ln2g, layer.ln2b)
            sub = matmul(gelu(matmul(h2, layer.w1) + layer.b1), layer.w2) + layer.b2
            if training and dropout_p > 0:
                sub = dropout(sub, dropout_p, self.drop_rng)
            x = x + sub
        x = layernorm(x, self.lnfg, self.lnfb)
        return matmul(x, transpose(self.wte, (1, 0)))

    def loss(self, ids: np.ndarray, targets: np.ndarray, training: bool = False,
             dropout_p: float = 0.0, mask: np.ndarray | None = None) -> Tensor:
        logits = self.forward(ids, training=training, dropout_p=dropout_p)
        b, t, v = logits.shape
        flat = None if mask is None else mask.reshape(b * t)
        return cross_entropy(logits.reshape(b * t, v), targets.reshape(b * t), mask=flat)

    # -------------------------------------------------------------- inférence
    def forward_np(self, ids: np.ndarray, cache: list | None = None):
        """Forward NumPy pur avec cache KV (identique à kv.ts côté TypeScript)."""
        b, t = ids.shape
        past = 0 if cache is None else cache[0][0].shape[2]
        nh = self.heads
        hs = self.dim // nh
        x = self.wte.data[ids] + self.wpe.data[past:past + t][None, :, :]
        new_cache: list = []
        scale = float(1.0 / math.sqrt(hs))
        for li, layer in enumerate(self.layers):
            h = _layernorm_np(x, layer.ln1g.data, layer.ln1b.data)
            q = (h @ layer.wq.data).reshape(b, t, nh, hs).transpose(0, 2, 1, 3)
            k = (h @ layer.wk.data).reshape(b, t, nh, hs).transpose(0, 2, 1, 3)
            v = (h @ layer.wv.data).reshape(b, t, nh, hs).transpose(0, 2, 1, 3)
            if cache is not None:
                k = np.concatenate([cache[li][0], k], axis=2)
                v = np.concatenate([cache[li][1], v], axis=2)
            new_cache.append((k, v))
            s = (q @ k.transpose(0, 1, 3, 2)) * scale
            qpos = np.arange(past, past + t)[:, None]
            kpos = np.arange(k.shape[2])[None, :]
            s = s + np.where(kpos <= qpos, 0.0, -1e9).astype(np.float32)[None, None]
            p = np.exp(s - s.max(axis=-1, keepdims=True))
            p /= p.sum(axis=-1, keepdims=True)
            y = (p @ v).transpose(0, 2, 1, 3).reshape(b, t, self.dim)
            x = x + y @ layer.wo.data
            h2 = _layernorm_np(x, layer.ln2g.data, layer.ln2b.data)
            f = _gelu_np(h2 @ layer.w1.data + layer.b1.data)
            x = x + f @ layer.w2.data + layer.b2.data
        x = _layernorm_np(x, self.lnfg.data, self.lnfb.data)
        return x @ self.wte.data.T, new_cache

    def generate(self, prompt: str, encode_fn, decode_fn, max_new: int = 220,
                 temperature: float = 0.5, top_k: int = 6, repetition_penalty: float = 1.2,
                 seed: int = 42, eos_id: int | None = None) -> tuple[str, float]:
        rng = np.random.default_rng(seed)
        ids = [int(i) for i in encode_fn(prompt)][-self.ctx:]
        out: list[int] = []
        logits, cache = self.forward_np(np.array([ids], dtype=np.int64))
        nll = 0.0
        for _ in range(max_new):
            row = logits[0, -1].astype(np.float64)
            if len(out) >= 1:
                recent = set(out[-24:])
                for j in recent:
                    row[j] = row[j] / repetition_penalty if row[j] > 0 else row[j] * repetition_penalty
            row = row / max(0.05, temperature)
            top = np.argpartition(row, -top_k)[-top_k:]
            top = top[np.argsort(row[top])[::-1]]
            z = row[top] - row[top].max()
            p = np.exp(z)
            p /= p.sum()
            nxt = int(rng.choice(top, p=p))
            nll += -math.log(max(float(p[list(top).index(nxt)]), 1e-12))
            out.append(nxt)
            if eos_id is not None and nxt == eos_id:
                break
            if decode_fn(out).endswith("\n"):
                break
            if len(ids) + len(out) >= self.ctx:
                window = (ids + out)[-self.ctx:]
                logits, cache = self.forward_np(np.array([window], dtype=np.int64))
            else:
                logits, cache = self.forward_np(np.array([[nxt]], dtype=np.int64), cache)
        text = decode_fn(out)
        return text, (nll / max(1, len(out)))


def _layernorm_np(x: np.ndarray, g: np.ndarray, b: np.ndarray, eps: float = 1e-5) -> np.ndarray:
    mean = x.mean(axis=-1, keepdims=True)
    var = ((x - mean) ** 2).mean(axis=-1, keepdims=True)
    return (x - mean) / np.sqrt(var + eps) * g + b


def _gelu_np(x: np.ndarray) -> np.ndarray:
    c = 0.7978845608028654
    return 0.5 * x * (1.0 + np.tanh(c * (x + 0.044715 * x ** 3)))


# ────────────────────────────────────────────────────────────────────────────
# Données
# ────────────────────────────────────────────────────────────────────────────


def char_encoder(index: dict[str, int]):
    """Encodeur caractère (format historique)."""
    def encode_fn(text: str) -> np.ndarray:
        return np.fromiter((index.get(ch, 0) for ch in text), dtype=np.int64, count=len(text))
    return encode_fn


def pack_examples(examples: list[str], encode_fn, ctx: int, pad: int = 1) -> tuple[np.ndarray, int, np.ndarray]:
    """Emballage premier-ajustement décroissant : chaque fenêtre contient des exemples entiers.

    Renvoie aussi le MASQUE des positions réelles (voir `loss`) : le remplissage
    ne doit ni peser dans la perte ni produire de gradient.
    """
    encoded = sorted((encode_fn(e) for e in examples), key=len, reverse=True)
    bins: list[list[int]] = []
    used: list[int] = []
    for ids in encoded:
        need = len(ids) + 1
        placed = False
        for i, row in enumerate(bins):
            if used[i] + need <= ctx:
                row.extend(ids.tolist())
                row.append(pad)
                used[i] += need
                placed = True
                break
        if not placed:
            bins.append(ids.tolist() + [pad])
            used.append(min(need, ctx))
    blocks = len(bins) + 1
    data = np.full(blocks * ctx, pad, dtype=np.int64)
    keep = np.zeros(blocks * ctx, dtype=bool)
    for i, row in enumerate(bins):
        length = min(len(row), ctx)
        data[i * ctx:i * ctx + length] = row[:ctx]
        # La cible de la position j est data[j+1] : elle est réelle tant que
        # j+1 < length (le dernier token ajouté est le EOS de fin d'exemple).
        keep[i * ctx:i * ctx + max(0, length - 1)] = True
    return data, len(bins), keep


def answer_span(example: str) -> tuple[str, str]:
    at = example.rfind("\nR: ")
    if at < 0:
        return example, ""
    return example[: at + 4], example[at + 4:]


def validation_nll(model: ChatGPT, examples: list[str], encode_fn, limit: int | None = None) -> tuple[float, float, int]:
    """NLL moyenne de la réponse attendue (teacher forcing), et part dans le top-3."""
    total = 0.0
    counted = 0
    top3 = 0
    used = 0
    for ex in examples[: limit or len(examples)]:
        prompt, answer = answer_span(ex)
        if len(answer) < 8:
            continue
        ids = encode_fn(prompt + answer)
        if len(ids) > model.ctx:
            ids = ids[-model.ctx:]
        if len(ids) < 2:
            continue
        inp = ids[None, :-1]
        tgt = ids[1:]
        logits, _ = model.forward_np(inp)
        logits = logits[0]
        # ATTENTION : `len(prompt)` compte des CARACTÈRES. En BPE, la position du
        # début de la réponse est un indice de TOKENS — d'où le passage par
        # `encode_fn`. L'ancien calcul sautait la quasi-totalité de la réponse
        # et rendait la NLL de validation (donc le choix du checkpoint) faux.
        start = max(0, len(encode_fn(prompt)) - 1)
        rows = logits[start:]
        targets = tgt[start:]
        if len(targets) == 0:
            continue
        rows = rows - rows.max(axis=-1, keepdims=True)
        logp = rows - np.log(np.exp(rows).sum(axis=-1, keepdims=True))
        nll = -logp[np.arange(len(targets)), targets]
        total += float(nll.mean())
        top = np.argsort(-rows, axis=-1)[:, :3]
        top3 += int((top == targets[:, None]).any(axis=1).sum())
        counted += len(targets)
        used += 1
    return total / max(1, used), top3 / max(1, counted), counted


# ────────────────────────────────────────────────────────────────────────────
# Optimiseur
# ────────────────────────────────────────────────────────────────────────────


class AdamW:
    def __init__(self, params: list[Tensor], lr: float, wd: float = 0.01):
        self.params = params
        self.lr = lr
        self.wd = wd
        self.m = [np.zeros_like(p.data) for p in params]
        self.v = [np.zeros_like(p.data) for p in params]
        self.t = 0

    def step(self, lr: float) -> None:
        self.t += 1
        b1, b2, eps = 0.9, 0.99, 1e-8
        c1 = 1 - b1 ** self.t
        c2 = 1 - b2 ** self.t
        for i, p in enumerate(self.params):
            g = p.grad
            if g is None:
                continue
            self.m[i] = b1 * self.m[i] + (1 - b1) * g
            self.v[i] = b2 * self.v[i] + (1 - b2) * (g * g)
            mh = self.m[i] / c1
            vh = self.v[i] / c2
            decay = self.wd if p.data.ndim >= 2 else 0.0
            p.data -= (lr * (mh / (np.sqrt(vh) + eps) + decay * p.data)).astype(np.float32)


def clip_gradients(params: list[Tensor], max_norm: float = 1.0) -> float:
    total = 0.0
    for p in params:
        if p.grad is not None:
            total += float((p.grad * p.grad).sum())
    norm = math.sqrt(total)
    if norm > max_norm and norm > 0:
        k = max_norm / norm
        for p in params:
            if p.grad is not None:
                p.grad *= k
    return norm


def schedule(step: int, total: int, max_lr: float) -> float:
    warm = max(20, min(100, total // 10))
    if step < warm:
        return max_lr * step / warm
    progress = min(1.0, (step - warm) / max(1, total - warm))
    min_lr = max_lr / 10
    return min_lr + 0.5 * (max_lr - min_lr) * (1 + math.cos(math.pi * progress))


# ────────────────────────────────────────────────────────────────────────────
# Boucle principale
# ────────────────────────────────────────────────────────────────────────────


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", default="llm/data/chat_corpus_v2.json")
    ap.add_argument("--pretrain", default="llm/data/chat_pretrain_v2.txt")
    ap.add_argument("--pretrain-steps", type=int, default=700)
    ap.add_argument("--steps", type=int, default=2600)
    ap.add_argument("--batch", type=int, default=2)
    ap.add_argument("--lr", type=float, default=2.5e-3)
    ap.add_argument("--finetune-lr", type=float, default=1.2e-3)
    ap.add_argument("--dropout", type=float, default=0.05)
    ap.add_argument("--eval-every", type=int, default=250)
    ap.add_argument("--out", default="public/models/nexus-chat-v2")
    # Point de contrôle intermédiaire. Un nom explicite évite qu'un essai
    # (autre corpus) écrase le checkpoint du modèle de production.
    ap.add_argument("--ckpt", default="llm/checkpoints/nexus-chat-v2.npz")
    ap.add_argument("--metrics", default="llm/checkpoints/nexus-chat-v2-metrics.json")
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--seed", type=int, default=1337)
    # Tokenizer : `char` (v1/v2 livrés) ou `bpe` (sous-mots du dépôt, 2049 tokens).
    ap.add_argument("--tokenizer", choices=["char", "bpe"], default="char")
    ap.add_argument("--bpe", default="llm/data/tokenizer.json")
    ap.add_argument("--ctx", type=int, default=0, help="force la taille de contexte (tokens)")
    args = ap.parse_args()

    corpus = json.loads(Path(args.corpus).read_text(encoding="utf-8"))
    cfg = dict(corpus["config"])
    cfg["format"] = "chat-v1"
    if args.ctx:
        cfg["ctx"] = args.ctx
    itos: list[str] = []
    if args.tokenizer == "bpe":
        tok = BPETokenizer.load(ROOT / args.bpe)
        cfg["tokenizer"] = "bpe"
        cfg["vocab"] = tok.model_vocab_size
        pad_id = tok.eos_id
        eos_id = tok.eos_id
        encode_fn = lambda text: np.fromiter(tok.encode(text), dtype=np.int64)  # noqa: E731
        decode_fn = lambda ids: tok.decode([int(i) for i in ids])  # noqa: E731
        print(f"tokenizer · BPE {tok.vocab_size} + EOS · contexte {cfg['ctx']} tokens", flush=True)
    else:
        cfg["tokenizer"] = "char"
        itos = corpus["vocab"]
        index = {ch: i for i, ch in enumerate(itos)}
        pad_id = 1
        eos_id = None
        encode_fn = char_encoder(index)
        decode_fn = lambda ids: "".join(itos[i] if i > 1 else ("\n" if i == 1 else "") for i in ids if 0 <= i < len(itos))  # noqa: E731
        print(f"tokenizer · caractères · vocabulaire {len(itos)} · contexte {cfg['ctx']}", flush=True)
    examples: list[str] = corpus["examples"]
    train_examples = [examples[i] for i in corpus["train"]]
    val_examples = [examples[i] for i in corpus["val"]]
    ctx = int(cfg["ctx"])

    model = ChatGPT(cfg, seed=args.seed)
    print(f"modèle · {model.num_params():,} paramètres · ctx {ctx} · dim {cfg['dim']} · {cfg['layers']} couches", flush=True)
    print(f"corpus · {len(train_examples)} exemples d'entraînement · {len(val_examples)} de validation", flush=True)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    ckpt = Path(args.ckpt)
    if args.resume and ckpt.exists():
        saved = np.load(ckpt)
        for name, param in model.named_params():
            if name in saved:
                param.data[...] = saved[name]
        print(f"reprise depuis {ckpt}")

    opt = AdamW(model.params(), args.lr)
    t0 = time.time()
    log: list[dict] = []

    # 1. Pré-entraînement linguistique (prose française, caractère suivant).
    prose = Path(args.pretrain).read_text(encoding="utf-8")
    prose_ids = encode_fn(prose)
    print(f"pré-entraînement · {len(prose_ids):,} caractères de prose française · {args.pretrain_steps} pas", flush=True)
    rng = np.random.default_rng(args.seed + 7)
    model.zero_grad()
    for step in range(1, args.pretrain_steps + 1):
        x = np.empty((args.batch, ctx), dtype=np.int64)
        y = np.empty((args.batch, ctx), dtype=np.int64)
        for b in range(args.batch):
            s = int(rng.integers(0, len(prose_ids) - ctx - 2))
            x[b] = prose_ids[s:s + ctx]
            y[b] = prose_ids[s + 1:s + ctx + 1]
        model.zero_grad()
        loss = model.loss(x, y, training=True, dropout_p=args.dropout)
        loss.backward()
        norm = clip_gradients(model.params())
        lr = schedule(step, args.pretrain_steps, args.lr)
        opt.step(lr)
        if step % 50 == 0 or step == 1:
            print(f"  pré-étape {step:4d} · perte {float(loss.data):.4f} · lr {lr:.5f} · |g| {norm:.2f} · {time.time()-t0:.0f}s")
        if step % 200 == 0:
            log.append({"phase": "pretrain", "step": step, "loss": round(float(loss.data), 4)})

    # 2. Affinage conversationnel.
    data, blocks, keep = pack_examples(train_examples, encode_fn, ctx, pad=pad_id)
    print(f"affinage · {blocks} blocs de {ctx} · {args.steps} pas · lot {args.batch} · dropout {args.dropout}", flush=True)
    best = (float("inf"), -1, None)
    model.zero_grad()
    for step in range(1, args.steps + 1):
        x = np.empty((args.batch, ctx), dtype=np.int64)
        y = np.empty((args.batch, ctx), dtype=np.int64)
        m = np.empty((args.batch, ctx), dtype=bool)
        for b in range(args.batch):
            s = int(rng.integers(0, blocks)) * ctx
            x[b] = data[s:s + ctx]
            y[b] = data[s + 1:s + ctx + 1]
            m[b] = keep[s:s + ctx]
        model.zero_grad()
        loss = model.loss(x, y, training=True, dropout_p=args.dropout, mask=m)
        loss.backward()
        norm = clip_gradients(model.params())
        lr = schedule(step, args.steps, args.finetune_lr)
        opt.step(lr)
        if step % 50 == 0 or step == 1:
            print(f"  étape {step:4d} · perte {float(loss.data):.4f} · lr {lr:.5f} · |g| {norm:.2f} · {time.time()-t0:.0f}s")
        if step % args.eval_every == 0 or step == args.steps:
            val_nll, top3, counted = validation_nll(model, val_examples, encode_fn)
            print(f"  ─ validation · NLL {val_nll:.3f} · top-3 {top3*100:.0f}% ({counted} caractères)")
            log.append({"phase": "finetune", "step": step, "loss": round(float(loss.data), 4), "val_nll": round(val_nll, 4), "top3": round(top3, 4)})
            np.savez(ckpt, **{name: p.data for name, p in model.named_params()})
            if val_nll < best[0]:
                best = (val_nll, step, [p.data.copy() for p in model.params()])
                print(f"  ─ meilleur checkpoint (NLL {val_nll:.3f})")

    # 3. Évaluation finale et export dans le format TypeScript.
    # On reprend le MEILLEUR checkpoint (perplexité de validation), pas le
    # dernier pas : sur un petit corpus, les dernières étapes peuvent sur-apprendre.
    if best[2] is not None:
        for param, data in zip(model.params(), best[2]):
            param.data[...] = data
        print(f"meilleur checkpoint restauré (étape {best[1]}, NLL {best[0]:.3f})")
    val_nll, top3, counted = validation_nll(model, val_examples, encode_fn)
    samples: list[dict] = []
    for ex in val_examples[:6]:
        prompt, answer = answer_span(ex)
        if len(answer) < 8:
            continue
        text, _ = model.generate(prompt, encode_fn, decode_fn, max_new=200, seed=7, eos_id=eos_id)
        samples.append({"prompt": prompt, "attendu": answer, "généré": text})

    final_params = model.params()
    flat = np.concatenate([p.data.astype("<f4").ravel() for p in final_params])
    bin_path = out.with_suffix(".bin")
    flat.tofile(bin_path)
    meta = {
        "name": out.name,
        "format": "chat-v1",
        "config": cfg,
        "vocab": itos,
        "steps": args.pretrain_steps + args.steps,
        "loss": round(float(loss.data), 4),
        "params": model.num_params(),
        "corpusChars": corpus["corpusChars"],
        "corpusInfo": corpus["sources"],
        "exportedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "training": {
            "pretrainSteps": args.pretrain_steps,
            "finetuneSteps": args.steps,
            "pretrainChars": int(len(prose_ids)),
            "batch": args.batch,
            "dropout": args.dropout,
            "bestValNll": round(best[0], 4) if best[2] is not None else None,
            "bestStep": best[1],
            "valNll": round(val_nll, 4),
            "top3": round(top3, 4),
            "seconds": round(time.time() - t0, 1),
        },
        "samples": samples,
    }
    out.with_suffix(".json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    metrics = Path(args.metrics)
    metrics.parent.mkdir(parents=True, exist_ok=True)
    metrics.write_text(json.dumps({**meta, "log": log}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"exporté · {bin_path} ({flat.nbytes/1e6:.2f} Mo) · NLL validation {val_nll:.3f} · top-3 {top3*100:.0f}%")
    for s in samples:
        print(f"  Q: {s['prompt'].split('Q: ')[-1]!r} → {s['généré'][:120]!r}")


if __name__ == "__main__":
    main()
