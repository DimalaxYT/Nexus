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
| Modèle | GPT pre-norm : 6 couches, d_model 256, 8 têtes, contexte 256, poids embedding/sortie liés — **5,33 M paramètres** — `nexus_llm/model.py` |
| Optimisation | Adam (β 0,9/0,95), warmup + cosinus, clipping de gradient — `nexus_llm/optim.py` |
| Corpus | français Nexus (README, worklog, base de connaissances) + Tiny Shakespeare (domaine public) : 635 287 tokens |
| Génération | auto-régressive, température / top-k / top-p — `nexus_llm/model.py` |
| Inférence | serveur HTTP stdlib, zéro dépendance — `nexus_llm/serve.py` |

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

## Limites assumées (et pistes, voir TASKS.md)

Modèle volontairement petit (entraînement CPU, 2 cœurs / 4 Go) : il apprend
la langue et le vocabulaire du corpus, pas la connaissance du monde. Pas de
cache KV (génération O(T) par token), pas de quantification, contexte de
256 tokens. Ce sont des limites d'échelle, pas de nature : l'architecture,
les mathématiques et l'apprentissage sont ceux d'un vrai LLM.
