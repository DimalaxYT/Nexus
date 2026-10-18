"""Génération de texte depuis un checkpoint entraîné.

    python -m nexus_llm.generate --prompt "Bonjour, je suis" --tokens 120
    python -m nexus_llm.generate --prompt "NEXUS est" --temperature 0.7 --top-k 20

L'échantillonnage (température, top-k, top-p / nucleus) est implémenté dans
`model.py` ; arrêt automatique sur <|endoftext|> par défaut.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np

from .model import GPT
from .tokenizer import BPETokenizer

ROOT = Path(__file__).resolve().parents[1]


def load_all(ckpt: str | Path, tok_path: str | Path):
    model, meta = GPT.load(ckpt)
    tok = BPETokenizer.load(tok_path)
    return model, tok, meta


def generate_text(model: GPT, tok: BPETokenizer, prompt: str, max_new_tokens: int = 120,
                  temperature: float = 0.9, top_k: int = 40, top_p: float = 0.95,
                  seed: int | None = None, stop_at_eos: bool = True) -> str:
    rng = np.random.default_rng(seed)
    prompt_ids = tok.encode(prompt) or [tok.eos_id]
    out_ids = model.generate(prompt_ids, max_new_tokens=max_new_tokens,
                             temperature=temperature, top_k=top_k, top_p=top_p,
                             rng=rng, stop_at_eos=tok.eos_id if stop_at_eos else None)
    return tok.decode(out_ids)


def main() -> None:
    ap = argparse.ArgumentParser(description="Génère du texte avec le Nexus LLM")
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--tokens", type=int, default=120)
    ap.add_argument("--temperature", type=float, default=0.9)
    ap.add_argument("--top-k", type=int, default=40)
    ap.add_argument("--top-p", type=float, default=0.95)
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--ckpt", default=str(ROOT / "checkpoints/nexus-llm.npz"))
    ap.add_argument("--tokenizer", default=str(ROOT / "data/tokenizer.json"))
    args = ap.parse_args()

    model, tok, meta = load_all(args.ckpt, args.tokenizer)
    print(f"[generate] checkpoint étape {meta.get('step', '?')}, "
          f"perte d'entraînement {meta.get('train_loss', float('nan')):.3f}")
    print(f"\n{args.prompt}", end="", flush=True)
    text = generate_text(model, tok, args.prompt, args.tokens, args.temperature,
                         args.top_k, args.top_p, args.seed)
    print(text)


if __name__ == "__main__":
    main()
