"""Tests du tokenizer BPE : aller-retour exact, compression, robustesse.

Lançable : python tests/test_tokenizer.py   (ou via pytest)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from nexus_llm.tokenizer import BPETokenizer  # noqa: E402

CORPUS = (
    "Bonjour le monde, ceci est un texte d'entraînement pour le tokenizer. "
    "Le modèle de langue apprend la structure du français, token après token. "
    "Les agents Nexus travaillent ensemble : recherche, mémoire, génération. "
) * 30


def test_roundtrip():
    tok = BPETokenizer.train(CORPUS, vocab_size=400, verbose=False)
    samples = [
        "Bonjour, je suis Nexus !",
        "Texte avec accents : élève, où, ça, Noël… et emoji 🤖✨",
        "Code : def f(x): return x * 2  # 0123456789",
        "Caractères jamais vus à l'entraînement : € £ ¥ §",
        "",
    ]
    for s in samples:
        assert tok.decode(tok.encode(s)) == s, f"aller-retour cassé pour : {s!r}"
    print("aller-retour encode/décode exact sur tous les échantillons (y compris inconnus)")


def test_compression_and_eos():
    tok = BPETokenizer.train(CORPUS, vocab_size=400, verbose=False)
    text = "Le modèle de langue apprend la structure du français"
    ids = tok.encode(text)
    assert len(ids) < len(text.encode("utf-8")), "le BPE doit compresser vs les octets bruts"
    doc = tok.encode_document(text)
    assert doc[-1] == tok.eos_id and len(doc) == len(ids) + 1
    assert tok.model_vocab_size == tok.vocab_size + 1
    print(f"compression : {len(text.encode('utf-8'))} octets -> {len(ids)} tokens ; EOS OK")


if __name__ == "__main__":
    test_roundtrip()
    test_compression_and_eos()
    print("OK — tokenizer vérifié")
