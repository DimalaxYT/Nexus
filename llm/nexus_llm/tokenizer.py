"""Tokenizer BPE (Byte-Pair Encoding) byte-level, écrit de zéro.

Principe (identique à GPT-2, réimplémenté) :
  1. Le texte est pré-découpé en « mots » par regex (lettres / chiffres /
     espaces / ponctuation) pour ne jamais fusionner à travers eux.
  2. Chaque mot est converti en octets UTF-8 (vocabulaire de base : 256).
  3. On fusionne itérativement la paire d'ids adjacente la plus fréquente
     (pondérée par la fréquence des mots) jusqu'à atteindre la taille de
     vocabulaire cible. Un index paire→mots rend l'entraînement rapide.
  4. Un token spécial <|endoftext|> (id = vocab_size) sépare les documents.

Aucune dépendance externe. Zéro token inconnu : tout texte est encodable.
"""
from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from pathlib import Path

# Lettres (unicode, accents inclus) | nombres | suites d'espaces | autre caractère
_SPLIT_RE = re.compile(r"[^\W\d_]+|\d+|\s+|[^\s\w]", re.UNICODE)

EOS_TOKEN = "<|endoftext|>"


class BPETokenizer:
    def __init__(self, merges: list[tuple[int, int]] | None = None):
        self.merges: list[tuple[int, int]] = list(merges or [])
        self._ranks: dict[tuple[int, int], int] = {p: i for i, p in enumerate(self.merges)}
        # token id -> octets
        self._token_bytes: dict[int, bytes] = {i: bytes([i]) for i in range(256)}
        for i, (a, b) in enumerate(self.merges):
            self._token_bytes[256 + i] = self._token_bytes[a] + self._token_bytes[b]

    # ------------------------------------------------------------ propriétés
    @property
    def vocab_size(self) -> int:
        """Taille sans le token EOS (les ids vont de 0 à vocab_size-1)."""
        return 256 + len(self.merges)

    @property
    def eos_id(self) -> int:
        return self.vocab_size

    @property
    def model_vocab_size(self) -> int:
        """Taille à donner au modèle (vocabulaire + EOS)."""
        return self.vocab_size + 1

    # ------------------------------------------------------------ entraînement
    @classmethod
    def train(cls, text: str, vocab_size: int = 2048, verbose: bool = True) -> "BPETokenizer":
        if vocab_size <= 256:
            raise ValueError("vocab_size doit être > 256")
        chunks = _SPLIT_RE.findall(text)
        freq: Counter[str] = Counter(chunks)
        words: list[list[int]] = [list(w.encode("utf-8")) for w in freq]
        weights: list[int] = list(freq.values())
        if verbose:
            print(f"[tokenizer] {len(chunks):,} morceaux, {len(words):,} mots uniques")

        pair_counts: Counter[tuple[int, int]] = Counter()
        pair_to_words: dict[tuple[int, int], set[int]] = defaultdict(set)
        for wi, word in enumerate(words):
            for pair in zip(word, word[1:]):
                pair_counts[pair] += weights[wi]
                pair_to_words[pair].add(wi)

        merges: list[tuple[int, int]] = []
        n_merges = vocab_size - 256
        for step in range(n_merges):
            if not pair_counts:
                break
            # paire la plus fréquente ; départage déterministe sur la paire
            best_pair, best_count = max(pair_counts.items(), key=lambda kv: (kv[1], kv[0]))
            if best_count < 2:
                break
            new_id = 256 + step
            merges.append(best_pair)
            affected = list(pair_to_words.get(best_pair, ()))
            for wi in affected:
                word = words[wi]
                if len(word) < 2:
                    continue
                # retirer les anciennes paires du compteur
                for pair in zip(word, word[1:]):
                    pair_counts[pair] -= weights[wi]
                    if pair_counts[pair] <= 0:
                        del pair_counts[pair]
                    s = pair_to_words.get(pair)
                    if s is not None:
                        s.discard(wi)
                # fusionner toutes les occurrences de best_pair
                merged: list[int] = []
                i = 0
                while i < len(word):
                    if i < len(word) - 1 and (word[i], word[i + 1]) == best_pair:
                        merged.append(new_id)
                        i += 2
                    else:
                        merged.append(word[i])
                        i += 1
                words[wi] = merged
                for pair in zip(merged, merged[1:]):
                    pair_counts[pair] += weights[wi]
                    pair_to_words[pair].add(wi)
            if verbose and (step % 200 == 0 or step == n_merges - 1):
                a, b = best_pair
                print(f"[tokenizer] fusion {step + 1}/{n_merges} : {a}+{b} -> {new_id} (×{best_count})")
        if verbose:
            print(f"[tokenizer] terminé : vocabulaire = {256 + len(merges)} (+EOS)")
        return cls(merges)

    # ------------------------------------------------------------ encodage
    def _encode_chunk(self, chunk: str) -> list[int]:
        ids = list(chunk.encode("utf-8"))
        while len(ids) >= 2:
            best_rank, best_pair = None, None
            for pair in zip(ids, ids[1:]):
                rank = self._ranks.get(pair)
                if rank is not None and (best_rank is None or rank < best_rank):
                    best_rank, best_pair = rank, pair
            if best_pair is None:
                break
            new_id = 256 + best_rank
            merged, i = [], 0
            while i < len(ids):
                if i < len(ids) - 1 and (ids[i], ids[i + 1]) == best_pair:
                    merged.append(new_id)
                    i += 2
                else:
                    merged.append(ids[i])
                    i += 1
            ids = merged
        return ids

    def encode(self, text: str) -> list[int]:
        out: list[int] = []
        for chunk in _SPLIT_RE.findall(text):
            out.extend(self._encode_chunk(chunk))
        return out

    def encode_document(self, text: str) -> list[int]:
        """Encode un document et le termine par <|endoftext|>."""
        return self.encode(text) + [self.eos_id]

    def decode(self, ids: list[int]) -> str:
        raw = b"".join(self._token_bytes[i] for i in ids if i < self.vocab_size)
        return raw.decode("utf-8", errors="replace")

    # ------------------------------------------------------------ persistance
    def save(self, path: str | Path) -> None:
        Path(path).write_text(
            json.dumps({"merges": [list(p) for p in self.merges], "eos": EOS_TOKEN}),
            encoding="utf-8",
        )

    @classmethod
    def load(cls, path: str | Path) -> "BPETokenizer":
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        return cls([tuple(p) for p in data["merges"]])


if __name__ == "__main__":  # entraînement rapide en ligne de commande
    import argparse

    ap = argparse.ArgumentParser(description="Entraîne le tokenizer BPE Nexus")
    ap.add_argument("--corpus", required=True, help="fichier texte du corpus")
    ap.add_argument("--vocab-size", type=int, default=2048)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    text = Path(args.corpus).read_text(encoding="utf-8")
    tok = BPETokenizer.train(text, vocab_size=args.vocab_size)
    tok.save(args.out)
    sample = "Bonjour, je suis Nexus, un modèle de langue entraîné de zéro !"
    ids = tok.encode(sample)
    print(f"exemple : « {sample} » -> {len(ids)} tokens, aller-retour OK : {tok.decode(ids) == sample}")
