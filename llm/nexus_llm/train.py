"""Boucle d'entraînement du Nexus LLM.

Pipeline complet, de zéro : corpus → tokenizer BPE → ids → fenêtres (x, y)
→ forward GPT → cross-entropy → backward (notre autograd) → clipping →
Adam (warmup + cosinus) → checkpoints .npz + courbes dans train_log.csv.

Exemple :
    python -m nexus_llm.train --steps 800 --batch-size 32
Reprise :
    python -m nexus_llm.train --steps 400 --resume checkpoints/nexus-llm.npz
"""
from __future__ import annotations

import argparse
import csv
import ctypes
import gc
import math
import resource
import time
from pathlib import Path

import numpy as np

from .data import get_batch
from .model import GPT, GPTConfig
from .optim import Adam, clip_grad_norm, lr_at
from .tokenizer import BPETokenizer

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
CKPT = ROOT / "checkpoints"


def load_token_ids(tok: BPETokenizer, corpus_path: Path) -> np.ndarray:
    cache = DATA / f"token_ids_{corpus_path.stem}.npy"
    if cache.exists() and cache.stat().st_mtime > corpus_path.stat().st_mtime:
        return np.load(cache)
    text = corpus_path.read_text(encoding="utf-8")
    ids: list[int] = []
    # Encodage document par document pour placer les EOS correctement.
    for doc in text.split("<|endoftext|>"):
        doc = doc.strip("\n")
        if doc.strip():
            ids.extend(tok.encode_document(doc))
    arr = np.array(ids, dtype=np.int32)
    np.save(cache, arr)
    return arr


@np.errstate(all="ignore")
def evaluate(model: GPT, ids: np.ndarray, block: int, batch: int, rng, batches: int = 8) -> float:
    losses = []
    for _ in range(batches):
        x, y = get_batch(ids, block, batch, rng)
        loss_t = model.loss(x, y)
        losses.append(float(loss_t.data))
        # CRITIQUE mémoire : un graphe forward forme des cycles (nœud <->
        # fermeture), libérables seulement par le GC cyclique — qui compte
        # les objets Python, pas les octets NumPy. Sans collecte forcée,
        # les `batches` graphes s'accumulent (pic mesuré : ~3 Go) -> OOM.
        del loss_t, x, y
        gc.collect()
    return float(np.mean(losses))


def main() -> None:
    ap = argparse.ArgumentParser(description="Entraîne le Nexus LLM (GPT NumPy de zéro)")
    ap.add_argument("--steps", type=int, default=800)
    ap.add_argument("--batch-size", type=int, default=32)
    ap.add_argument("--block-size", type=int, default=256)
    ap.add_argument("--n-layer", type=int, default=6)
    ap.add_argument("--n-embd", type=int, default=256)
    ap.add_argument("--n-head", type=int, default=8)
    ap.add_argument("--vocab-size", type=int, default=2048)
    ap.add_argument("--lr", type=float, default=3e-3)
    ap.add_argument("--warmup", type=int, default=40)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--resume", type=str, default="")
    ap.add_argument("--corpus", type=str, default="corpus.txt",
                    help="fichier corpus dans data/ (ex. corpus_fr.txt pour l'affinage)")
    ap.add_argument("--out", type=str, default=str(CKPT / "nexus-llm.npz"))
    ap.add_argument("--log-every", type=int, default=20)
    ap.add_argument("--eval-every", type=int, default=100)
    args = ap.parse_args()

    CKPT.mkdir(parents=True, exist_ok=True)
    corpus_path = DATA / args.corpus
    tok_path = DATA / "tokenizer.json"
    if not corpus_path.exists():
        raise SystemExit("Corpus absent : lancez d'abord `python -m nexus_llm.data`")
    if not tok_path.exists():
        print("[train] tokenizer absent, entraînement du BPE…")
        tok = BPETokenizer.train(corpus_path.read_text(encoding="utf-8"), vocab_size=args.vocab_size)
        tok.save(tok_path)
    else:
        tok = BPETokenizer.load(tok_path)

    ids = load_token_ids(tok, corpus_path)
    n_val = max(args.block_size * args.batch_size * 4, len(ids) // 20)
    train_ids, val_ids = ids[:-n_val], ids[-n_val:]
    print(f"[train] corpus : {len(ids):,} tokens (train {len(train_ids):,}, val {len(val_ids):,}), "
          f"vocab modèle = {tok.model_vocab_size}")

    config = GPTConfig(vocab_size=tok.model_vocab_size, block_size=args.block_size,
                       n_layer=args.n_layer, n_embd=args.n_embd, n_head=args.n_head)
    model = GPT(config, seed=args.seed)
    start_step = 0
    if args.resume:
        model, meta = GPT.load(args.resume)
        start_step = int(meta.get("step", 0))
        print(f"[train] reprise depuis {args.resume} (étape {start_step})")
    print(f"[train] modèle : {model.num_params() / 1e6:.2f} M paramètres, config = {config}")

    params = model.params()
    opt = Adam(params, beta1=0.9, beta2=0.95, weight_decay=0.01)
    rng = np.random.default_rng(args.seed)

    log_path = CKPT / "train_log.csv"
    new_log = not log_path.exists()
    log_file = log_path.open("a", newline="")
    writer = csv.writer(log_file)
    if new_log:
        writer.writerow(["step", "train_loss", "val_loss", "lr", "grad_norm", "elapsed_s"])

    t0 = time.time()
    running = None
    for step in range(start_step, start_step + args.steps):
        x, y = get_batch(train_ids, args.block_size, args.batch_size, rng)
        model.zero_grad()
        loss_t = model.loss(x, y)
        loss = float(loss_t.data)  # lu avant backward (les intermédiaires sont libérés pendant)
        loss_t.backward()
        norm = clip_grad_norm(params, 1.0)
        lr = lr_at(step - start_step, args.steps, args.lr, warmup=args.warmup)
        opt.step(lr)
        del loss_t, x, y
        if step % 25 == 0:
            # Hygiène mémoire d'un entraînement CPU long : les graphes forment
            # des cycles (nœud <-> fermeture) libérés par le GC, et les arènes
            # glibc fragmentent. On force les deux nettoyages, sinon le RSS
            # dérive de ~10 Mo/étape jusqu'à l'OOM (observé en pratique).
            gc.collect()
            ctypes.CDLL("libc.so.6").malloc_trim(0)
        running = loss if running is None else 0.95 * running + 0.05 * loss

        if step % args.log_every == 0 or step == start_step + args.steps - 1:
            elapsed = time.time() - t0
            rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024
            print(f"étape {step:5d} | perte {loss:7.4f} (moy. {running:7.4f}) | "
                  f"ppl {math.exp(min(running, 20)):8.2f} | lr {lr:.2e} | "
                  f"|g| {norm:6.2f} | {elapsed:6.1f}s | RSS {rss} Mo", flush=True)
        if step % args.eval_every == 0 or step == start_step + args.steps - 1:
            val = evaluate(model, val_ids, args.block_size, args.batch_size, rng)
            writer.writerow([step, f"{running:.4f}", f"{val:.4f}", f"{lr:.6f}",
                             f"{norm:.3f}", f"{time.time() - t0:.1f}"])
            log_file.flush()
            print(f"          ↳ validation : perte {val:.4f} | perplexité {math.exp(min(val, 20)):.2f}", flush=True)
            model.save(CKPT / "nexus-llm-latest.npz",
                       extra={"step": step, "train_loss": running, "val_loss": val,
                              "tokenizer": "data/tokenizer.json"})

    total = time.time() - t0
    model.save(args.out, extra={"step": start_step + args.steps, "train_loss": running,
                                "tokenizer": "data/tokenizer.json", "trained_seconds": total})
    print(f"[train] terminé en {total:.0f}s — checkpoint : {args.out}")


if __name__ == "__main__":
    main()
