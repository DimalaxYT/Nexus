# Nexus LLM — un vrai modèle de langue, créé de zéro

**Aucun Ollama. Aucune API. Aucun poids pré-entraîné. Aucun framework de
deep learning.** Ce dossier contient un Transformer décodeur (architecture
GPT) entièrement écrit à la main : tokenizer BPE, moteur
d'autodifférentiation, attention causale, optimiseur Adam, boucle
d'entraînement et génération — en **NumPy uniquement** (voir
`requirements.txt`).

Il ne contient **aucune réponse pré-écrite** : le modèle apprend la
statistique du corpus par descente de gradient, prouvée par vérification
numérique des gradients (erreur ~5×10⁻¹⁰) et par la chute de perte mesurée
(voir `RESULTS.md`).

## Architecture

| Composant | Implémentation maison |
|---|---|
| Tokenizer | BPE byte-level (256 octets + fusions apprises + `<\|endoftext\|>`) — `nexus_llm/tokenizer.py` |
| Autodifférentiation | graphe inverse : matmul, softmax, LayerNorm, embedding, cross-entropy, attention fusionnée, ReLU — `nexus_llm/autograd.py` |
| Modèle | GPT pre-norm, poids embedding/sortie liés, contexte 256 — v1 : 6 couches × 256 (**5,33 M paramètres**, entraîné, voir `RESULTS.md`) ; v2 : 8 couches × 384, 12 têtes (**15,9 M**, tokenizer 4096, amorcé étape 100) — `nexus_llm/model.py` |
| Optimisation | Adam (β 0,9/0,95), warmup + cosinus, clipping de gradient — `nexus_llm/optim.py` |
| Corpus | français Nexus (README, worklog, base de connaissances) + Tiny Shakespeare (domaine public) : 635 287 tokens |
| Génération | auto-régressive avec **cache KV** (un pas par token, équivalence prouvée par test), température / top-k / top-p / **pénalité de répétition** — `nexus_llm/model.py` |
| Inférence | serveur HTTP stdlib, zéro dépendance ; tokenizer résolu depuis les métadonnées du checkpoint — `nexus_llm/serve.py` |

Choix d'ingénierie documentés dans le code : attention en primitive
fusionnée (les scores sont recalculés au backward, principe de
FlashAttention), libération des tenseurs intermédiaires pendant la
rétropropagation, ReLU plutôt que GELU (`np.tanh` coûtait ~45 % du temps
d'étape au profilage), et garde-fou float32 strict (un scalaire
`np.float64` promouvait tout le calcul en float64 — NEP 50).

## Démarrage rapide

```bash
cd llm
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt

# 1. Corpus (textes du dépôt ; Tiny Shakespeare optionnel dans data/external/)
python -m nexus_llm.data

# 2. Tests (gradients vérifiés numériquement, tokenizer, apprentissage)
python tests/test_autograd.py && python tests/test_tokenizer.py && python tests/test_model.py

# 3. Entraînement (tokenizer BPE créé automatiquement au 1er lancement)
python -m nexus_llm.train --steps 1000 --batch-size 8
#    reprise : python -m nexus_llm.train --steps 500 --resume checkpoints/nexus-llm-latest.npz

# 4. Génération
python -m nexus_llm.generate --prompt "Bonjour, je suis" --tokens 120 --temperature 0.9

# 5. Serveur local pour l'application Nexus (http://127.0.0.1:8765)
python -m nexus_llm.serve --port 8765
```

## Intégration à Nexus

- `src/lib/brain/llm-local.ts` : client (état + génération, repli `null`
  si le serveur est éteint — le reste de l'app n'est jamais bloqué).
- `src/app/api/llm/route.ts` : `GET /api/llm` (état du modèle),
  `POST /api/llm` (génération). Variable optionnelle `NEXUS_LLM_URL`
  (défaut `http://127.0.0.1:8765`).

## Entraînement v2 (15,9 M paramètres) — à lancer de votre côté

Le code est prêt et le pré-entraînement v2 est amorcé (checkpoint
`nexus-llm-latest.npz`, étape 100, reprenable). Commandes :

```bash
# 1. Continuer le pré-entraînement (romans FR ELTeC + Shakespeare + Nexus)
python -m nexus_llm.train --corpus corpus_v2.txt --tokenizer tokenizer_v2.json \
  --resume checkpoints/nexus-llm-latest.npz --steps 550 \
  --n-layer 8 --n-embd 384 --n-head 12 --lr 2e-3 \
  --out checkpoints/nexus-llm-v2.npz

# 2. Affinage français (prose Nexus nettoyée)
python -m nexus_llm.train --corpus corpus_fr.txt --tokenizer tokenizer_v2.json \
  --resume checkpoints/nexus-llm-v2.npz --steps 300 --lr 8e-4 \
  --out checkpoints/nexus-llm-v2fr.npz

# 3. Promouvoir le meilleur checkpoint en modèle servi par défaut
cp checkpoints/nexus-llm-best.npz checkpoints/nexus-llm.npz
cp checkpoints/nexus-llm-best.json checkpoints/nexus-llm.json
python -m nexus_llm.serve --port 8765
```

Outils d'entraînement intégrés : **accumulation de gradient**
(`--grad-accum`, batch effectif sans pic mémoire), **état Adam persisté**
(`*.optim.npz` : reprise fidèle, plus de redémarrage à froid),
**meilleur checkpoint automatique** (`nexus-llm-best.npz` sur perplexité
de validation), garde anti-NaN, `--eval-batches` réglable. En cas
d'interruption, `--resume` repart du dernier `nexus-llm-latest.npz`.

## Limites assumées (et pistes, voir TASKS.md)

Modèles volontairement petits (entraînement CPU, 2 cœurs / 4 Go) : ils
apprennent la langue et le vocabulaire du corpus, pas la connaissance du
monde. Pas de quantification, contexte de 256 tokens, décodage séquentiel
(même avec cache KV). Ce sont des limites d'échelle, pas de nature :
l'architecture, les mathématiques et l'apprentissage sont ceux d'un
vrai LLM.
