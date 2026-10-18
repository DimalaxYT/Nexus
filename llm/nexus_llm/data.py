"""Préparation du corpus d'entraînement.

Sources (100 % locales ou publiques, aucun service d'IA) :
  - textes français du dépôt Nexus : README, worklog (journal de bord FR),
    base de connaissances et jeu de données du cerveau historique ;
  - Tiny Shakespeare (domaine public, via le dépôt GitHub char-rnn de Karpathy)
    si `data/external/.../input.txt` est présent.

Sortie : `data/corpus.txt` (documents séparés par une ligne <|endoftext|>)
et `data/stats.json`. Lançable : `python -m nexus_llm.data`.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]          # llm/
REPO = ROOT.parent                                   # Nexus/
DATA = ROOT / "data"

FR_SOURCES = [
    REPO / "README.md",
    REPO / "worklog.md",
    REPO / "src/lib/brain/knowledge-bank.ts",
    REPO / "src/lib/brain/dataset.ts",
]
SHAKESPEARE = DATA / "external/tinyshakespeare.txt"
SEPARATOR = "\n\n<|endoftext|>\n\n"


def build_corpus() -> tuple[str, dict]:
    docs: list[tuple[str, str]] = []
    for path in FR_SOURCES:
        if path.exists():
            docs.append((f"nexus:{path.name}", path.read_text(encoding="utf-8", errors="ignore")))
    if SHAKESPEARE.exists():
        docs.append(("tinyshakespeare", SHAKESPEARE.read_text(encoding="utf-8", errors="ignore")))
    corpus = SEPARATOR.join(text for _, text in docs)
    stats = {
        "documents": [name for name, _ in docs],
        "chars": {name: len(text) for name, text in docs},
        "total_chars": len(corpus),
    }
    return corpus, stats


def _extract_french_strings(ts_text: str) -> list[str]:
    """Extrait les chaînes de caractères françaises d'un fichier TypeScript.

    Le corpus brut mélange code et français ; pour l'affinage on ne garde
    que les chaînes longues à forte proportion de lettres/espaces."""
    import re

    out = []
    for m in re.finditer(r"""['"`]([^'"`\n]{25,400})['"`]""", ts_text):
        s = m.group(1).strip()
        letters = sum(c.isalpha() or c.isspace() for c in s)
        if len(s) >= 25 and letters / len(s) > 0.75 and " " in s:
            out.append(s)
    return out


def _clean_markdown_prose(md: str) -> str:
    """Ne garde que la prose : retire blocs de code, liens, tableaux,
    titres markdown et lignes dominées par les symboles/chiffres.
    Le corpus brut (changelog technique) est sinon surtout du bruit
    syntaxique pour un petit modèle."""
    import re

    md = re.sub(r"```.*?```", " ", md, flags=re.S)          # blocs de code
    md = re.sub(r"`[^`\n]*`", " ", md)                       # code en ligne
    md = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", md)            # images
    md = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", md)         # liens -> texte
    md = re.sub(r"https?://\S+", " ", md)                    # URLs
    kept: list[str] = []
    for line in md.splitlines():
        line = line.strip().lstrip("#>*-+ ").strip()
        if len(line) < 30:
            continue
        letters = sum(c.isalpha() or c.isspace() for c in line)
        if letters / len(line) < 0.72:
            continue
        kept.append(line)
    return "\n".join(kept)


def build_fr_corpus(repeat: int = 3) -> tuple[str, dict]:
    """Corpus d'affinage 100 % français : prose markdown nettoyée + phrases des .ts."""
    docs: list[tuple[str, str]] = []
    for path in FR_SOURCES:
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        if path.suffix == ".ts":
            strings = _extract_french_strings(text)
            docs.append((f"nexus-fr:{path.name}", "\n".join(strings)))
        else:
            docs.append((f"nexus-fr:{path.name}", _clean_markdown_prose(text)))
    joined = SEPARATOR.join(text for _, text in docs)
    corpus = SEPARATOR.join([joined] * repeat)  # pondération par répétition
    stats = {
        "documents": [name for name, _ in docs],
        "chars": {name: len(text) for name, text in docs},
        "repeat": repeat,
        "total_chars": len(corpus),
    }
    return corpus, stats


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser(description="Prépare le corpus d'entraînement")
    ap.add_argument("--fr", action="store_true", help="corpus d'affinage 100 % français")
    args = ap.parse_args()
    DATA.mkdir(parents=True, exist_ok=True)
    if args.fr:
        corpus, stats = build_fr_corpus()
        (DATA / "corpus_fr.txt").write_text(corpus, encoding="utf-8")
        (DATA / "stats_fr.json").write_text(json.dumps(stats, indent=2, ensure_ascii=False), encoding="utf-8")
    else:
        corpus, stats = build_corpus()
        (DATA / "corpus.txt").write_text(corpus, encoding="utf-8")
        (DATA / "stats.json").write_text(json.dumps(stats, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(stats, indent=2, ensure_ascii=False))


def get_batch(ids: np.ndarray, block_size: int, batch_size: int, rng) -> tuple:  # noqa: ANN001
    """Échantillonne des fenêtres aléatoires (x, y décalé d'un token)."""
    import numpy as np

    starts = rng.integers(0, len(ids) - block_size - 1, size=batch_size)
    x = np.stack([ids[s:s + block_size] for s in starts]).astype(np.int64)
    y = np.stack([ids[s + 1:s + block_size + 1] for s in starts]).astype(np.int64)
    return x, y


if __name__ == "__main__":
    main()
