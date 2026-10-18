"""Génération de texte depuis un checkpoint entraîné.

    python -m nexus_llm.generate --prompt "Bonjour, je suis" --tokens 120
    python -m nexus_llm.generate --prompt "NEXUS est" --temperature 0.7 --top-k 20

Le tokenizer est résolu automatiquement depuis les métadonnées du
checkpoint (champ `tokenizer` du .json associé) : impossible de décoder
un modèle v2 avec le tokenizer v1 par accident. `--tokenizer` force un
autre fichier. L'échantillonnage (température, top-k, top-p, pénalité de
répétition) et le cache KV sont implémentés dans `model.py`.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np

from .model import GPT
from .tokenizer import BPETokenizer

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CKPT = ROOT / "checkpoints/nexus-llm.npz"


def resolve_tokenizer_path(ckpt: str | Path, meta: dict,
                           override: str | Path | None = None) -> Path:
    if override:
        return Path(override)
    recorded = meta.get("tokenizer")
    if recorded:  # chemin relatif à la racine llm/, ex. "data/tokenizer_v2.json"
        candidate = ROOT / recorded
        if candidate.exists():
            return candidate
    return ROOT / "data/tokenizer.json"


def load_all(ckpt: str | Path, tok_path: str | Path | None = None):
    model, meta = GPT.load(ckpt)
    tok = BPETokenizer.load(resolve_tokenizer_path(ckpt, meta, tok_path))
    return model, tok, meta


def generate_text(model: GPT, tok: BPETokenizer, prompt: str, max_new_tokens: int = 120,
                  temperature: float = 0.9, top_k: int = 40, top_p: float = 0.95,
                  repetition_penalty: float = 1.0, seed: int | None = None,
                  stop_at_eos: bool = True) -> str:
    rng = np.random.default_rng(seed)
    prompt_ids = tok.encode(prompt) or [tok.eos_id]
    out_ids = model.generate(prompt_ids, max_new_tokens=max_new_tokens,
                             temperature=temperature, top_k=top_k, top_p=top_p,
                             repetition_penalty=repetition_penalty,
                             rng=rng, stop_at_eos=tok.eos_id if stop_at_eos else None)
    return tok.decode(out_ids)


def main() -> None:
    ap = argparse.ArgumentParser(description="Génère du texte avec le Nexus LLM")
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--tokens", type=int, default=120)
    ap.add_argument("--temperature", type=float, default=0.9)
    ap.add_argument("--top-k", type=int, default=40)
    ap.add_argument("--top-p", type=float, default=0.95)
    ap.add_argument("--repetition-penalty", type=float, default=1.1,
                    help="> 1 pénalise les tokens déjà émis (anti-boucles)")
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--ckpt", default=str(DEFAULT_CKPT))
    ap.add_argument("--tokenizer", default=None,
                    help="par défaut : celui enregistré dans le checkpoint")
    args = ap.parse_args()

    model, tok, meta = load_all(args.ckpt, args.tokenizer)
    print(f"[generate] checkpoint étape {meta.get('step', '?')}, "
          f"perte d'entraînement {meta.get('train_loss', float('nan')):.3f}")
    print(f"\n{args.prompt}", end="", flush=True)
    text = generate_text(model, tok, args.prompt, args.tokens, args.temperature,
                         args.top_k, args.top_p, args.repetition_penalty, args.seed)
    print(text)


if __name__ == "__main__":
    main()
