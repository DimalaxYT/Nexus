#!/usr/bin/env python3
"""Génère les fixtures de non-régression du tokenizer BPE.

Les ids attendus sont produits par l'implémentation PYTHON de référence
(`llm/nexus_llm/tokenizer.py`) à partir des fusions livrées dans
`src/lib/llm/tokenizer-merges.json`, puis écrits dans
`scripts/fixtures/bpe-fixtures.json` — un chemin SUIVI PAR GIT, pour que
`scripts/check-bpe.ts` fonctionne depuis un clone neuf (une première version
écrivait dans `tmp/`, non suivi : l'outil livré était cassé au premier nettoyage).

Usage :  python3 scripts/gen-bpe-fixtures.py
Puis :   node --import tsx scripts/check-bpe.ts
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "llm"))

from nexus_llm.tokenizer import BPETokenizer  # noqa: E402

MERGES = ROOT / "src" / "lib" / "llm" / "tokenizer-merges.json"
OUT = ROOT / "scripts" / "fixtures" / "bpe-fixtures.json"

# Cas choisis pour couvrir chaque comportement du tokenizer : ASCII, accents,
# majuscules, chiffres et ponctuation, sauts de ligne, emoji (hors vocabulaire →
# octets), caractères jamais vus, et le « _ » que le regex de pré-découpage ne
# capture dans AUCUNE des deux implémentations (donc non restitué des deux côtés).
CASES = [
    "Bonjour, je suis NEXUS ?",
    "Bonsoir ! Installe-toi, je suis là.",
    "Le château était très beau en été.",
    "12 + 45 = 57, soit 57 ÷ 3 ≈ 19.",
    "ligne une\nligne deux\n",
    "Transformer models learn statistics from text.",
    "🎃 Halloween et 🎄 Noël tombent en oct et dec.",
    "÷ × ≈ ∞ ₡ — des symboles jamais vus.",
    "snake_case_variable et un_autre_exemple",
    "Q: Qui es-tu ?\nR: Je suis NEXUS, un agent IA local.",
    "L'huile d'olive, les pâtes, la pizza — d'accord ?",
]


def main() -> None:
    tok = BPETokenizer.load(MERGES)
    cases = []
    for text in CASES:
        ids = tok.encode(text)
        back = tok.decode(ids)
        cases.append({"text": text, "ids": ids, "roundtrip_ok": back == text})

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {"vocab": tok.model_vocab_size, "eos": tok.eos_id, "cases": cases},
            ensure_ascii=False,
            indent=1,
        )
        + "\n",
        encoding="utf-8",
    )
    exact = sum(1 for c in cases if c["roundtrip_ok"])
    print(
        f"{len(cases)} fixtures écrites dans {OUT.relative_to(ROOT)} · "
        f"vocabulaire modèle {tok.model_vocab_size} (EOS {tok.eos_id}) · "
        f"aller-retour exact {exact}/{len(cases)}"
    )
    for c in cases:
        if not c["roundtrip_ok"]:
            print(f"  (sans aller-retour exact, comme attendu : « {c['text'][:44]} »)")


if __name__ == "__main__":
    main()
