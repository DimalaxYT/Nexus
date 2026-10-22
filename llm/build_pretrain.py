"""Construit le texte de pré-entraînement du modèle de conversation NEXUS.

Le modèle `chat-v1` apprend deux choses, dans deux phases :

1. **Pré-entraînement linguistique** — prédire le caractère suivant sur de la
   prose française réelle (romans francophones du domaine public déjà présents
   dans `data/corpus_v2.txt`, documentation française de NEXUS). C'est ce qui
   lui donne l'orthographe, la grammaire et le vocabulaire ; sans cette phase,
   un modèle de 900 k paramètres entraîné sur 240 k caractères de dialogue
   apprend surtout des formules.
2. **Affinage conversationnel** — le format `H:/Q:/C:/R:` (voir
   `src/lib/llm/chat-corpus.ts`).

Aucune donnée téléchargée : les deux sources sont déjà versionnées dans le
dépôt. Le fichier produit (`data/chat_pretrain_v2.txt`) est reproductible :

    python llm/build_pretrain.py
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
OUT = DATA / "chat_pretrain_v2.txt"
STATS = DATA / "stats_pretrain_v2.json"

NOVELS_TARGET = 300_000
DOCS_TARGET = 150_000

FRENCH_STOP = re.compile(
    r"\b(le|la|les|un|une|des|du|de|et|est|je|tu|il|elle|nous|vous|ils|elles|"
    r"que|qui|dans|pour|pas|sur|avec|au|aux|ce|cette|ces|son|sa|ses|mais|"
    r"comme|plus|tout|bien|fait|dit|être|avoir)\b",
    re.IGNORECASE,
)
ENGLISH_STOP = re.compile(r"\b(the|and|of|to|in|that|is|you|for|with|this|are|not|his|her)\b", re.IGNORECASE)
BAD = re.compile(r"[|#`{}\[\]<>]|https?://|_{3,}|={3,}|\S*\d{3,}\S*")
FOOTNOTE = re.compile(r"\[\d+\]")
SPACES = re.compile(r"[ \t]+")


def clean_paragraph(text: str) -> str:
    text = text.replace("\u2019", "'").replace("\u201c", '"').replace("\u201d", '"')
    text = text.replace("\u2014", " — ").replace("\u2013", " – ")
    text = FOOTNOTE.sub("", text)
    text = SPACES.sub(" ", text).strip()
    return text


def is_french(text: str) -> bool:
    fr = len(FRENCH_STOP.findall(text))
    en = len(ENGLISH_STOP.findall(text))
    return fr >= 3 and fr > en * 2


def keep_paragraph(text: str, min_len: int = 80, max_len: int = 700) -> bool:
    if len(text) < min_len or len(text) > max_len:
        return False
    if BAD.search(text):
        return False
    letters = sum(ch.isalpha() for ch in text)
    if letters < len(text) * 0.62:
        return False
    if not is_french(text):
        return False
    # Les listes de noms propres et les suites de chiffres n'apprennent pas la langue.
    words = text.split()
    if len(words) < 12:
        return False
    upper = sum(1 for w in words if w[:1].isupper())
    if upper > len(words) * 0.45:
        return False
    return True


def novels_text(target: int) -> str:
    raw = (DATA / "corpus_v2.txt").read_text(encoding="utf-8")
    chunks: list[str] = []
    size = 0
    # Les documents sont mélangés : on parcourt tout le fichier par fenêtres
    # régulières pour ne pas prendre un seul roman (style trop homogène).
    stride = 11_000
    for start in range(0, len(raw), stride):
        window = raw[start : start + stride]
        for para in re.split(r"\n+", window):
            para = clean_paragraph(para)
            if not keep_paragraph(para):
                continue
            chunks.append(para)
            size += len(para) + 1
            if size >= target:
                return "\n".join(chunks)
    return "\n".join(chunks)


def docs_text(target: int) -> str:
    raw = (DATA / "corpus_fr.txt").read_text(encoding="utf-8")
    chunks: list[str] = []
    size = 0
    for para in re.split(r"\n+", raw):
        para = clean_paragraph(re.sub(r"^[#>\-\s•]+", "", para))
        if keep_paragraph(para, min_len=70, max_len=500):
            chunks.append(para)
            size += len(para) + 1
            if size >= target:
                break
    return "\n".join(chunks)


def main() -> None:
    novels = novels_text(NOVELS_TARGET)
    docs = docs_text(DOCS_TARGET)
    text = "\n\n".join([p for p in (novels, docs) if p]) + "\n"
    OUT.write_text(text, encoding="utf-8")
    STATS.write_text(
        json.dumps(
            {
                "sources": {
                    "romans_francophones": {"chars": len(novels), "origin": "data/corpus_v2.txt"},
                    "documentation_nexus": {"chars": len(docs), "origin": "data/corpus_fr.txt"},
                },
                "chars": len(text),
                "words": len(text.split()),
                "output": str(OUT.relative_to(ROOT.parent)),
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"{OUT.name} : {len(text):,} caractères · {len(text.split()):,} mots".replace(",", " "))


if __name__ == "__main__":
    main()
