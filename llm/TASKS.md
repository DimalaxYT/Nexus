# Nexus LLM — Plan séquencé

Objectif : un **vrai modèle de langue** (Transformer décodeur, type GPT), créé
entièrement de zéro dans ce dépôt. Aucun Ollama, aucun appel API externe, aucun
poids pré-entraîné téléchargé : tokenizer, autodifférentiation, architecture,
optimiseur et boucle d'entraînement sont écrits à la main (NumPy uniquement).

| # | Tâche | État |
|---|-------|------|
| 1 | Fondations : structure `llm/`, environnement NumPy vérifié (BLAS ~275 GFLOPS) | ✅ |
| 2 | Tokenizer BPE byte-level écrit de zéro + tests aller-retour | ✅ |
| 3 | Moteur d'autodifférentiation (graphe inverse) + vérification numérique des gradients | ✅ erreur ~5×10⁻¹⁰ |
| 4 | Architecture GPT : embedding, attention causale multi-têtes, MLP ReLU, LayerNorm, poids liés | ✅ 5,33 M params |
| 5 | Corpus : textes français Nexus (README, worklog, base de connaissances) + Tiny Shakespeare | ✅ 635 287 tokens |
| 6 | Entraînement : Adam, warmup+cosinus, clipping, checkpoints, perplexité train/val | ✅ 1 750 étapes en 3 phases, perplexité val. 999 → 24,7 |
| 7 | Génération : température, top-k, top-p | ✅ + échantillons réels dans `RESULTS.md` |
| 8 | Serveur d'inférence local (stdlib http.server, zéro dépendance) | ✅ testé bout-en-bout (`/health`, `/generate`) |
| 9 | Intégration Nexus : client TS `llm-local.ts` + route `/api/llm` (dégradation gracieuse) | ✅ typecheck strict OK |
| 10 | Tests de bout en bout, résultats mesurés (`RESULTS.md`), documentation | ✅ |

Contraintes assumées : 2 CPU / 4 Go RAM → modèle volontairement petit
(~5 M paramètres). C'est un vrai LLM au sens architectural et mathématique,
pas un modèle géant : il apprend la statistique du corpus par gradient,
il ne contient **aucune** réponse pré-écrite.

## Améliorations code (leçon des entraînements v1, aucun nouvel entraînement lancé)

| Amélioration | Détail | Preuve |
|---|---|---|
| Cache KV à la génération | `forward_np` NumPy pur + cache par couche ; avant : un forward complet par token | test d'équivalence des logits (préfixe + token par token) |
| Pénalité de répétition | `filter_logits` pur et testable, exposée CLI / serveur / API Nexus | test unitaire (probabilité du token répété réduite) |
| Tokenizer : cache par morceau | mémoïsation des mots à l'encodage (accélère le démarrage des entraînements) | aller-retour inchangé, tests verts |
| Tokenizer résolu par checkpoint | `generate`/`serve` lisent le champ `tokenizer` des métadonnées (anti-mélange v1/v2) | v2 chargé avec `tokenizer_v2.json` automatiquement |
| Accumulation de gradient | `--grad-accum` : batch effectif ↑ sans pic mémoire (micro-lots moyennés) | test fumée 4 étapes, perte décroissante |
| État Adam persisté | `*.optim.npz` sauvegardé/restauré (moments + t) : reprise fidèle | test fumée : « état Adam restauré (t=4) » |
| Meilleur checkpoint auto | `nexus-llm-best.npz` dès que la perplexité de validation s'améliore | test fumée : créé à chaque évaluation |
| Garde anti-NaN + `--eval-batches` | arrêt explicite si perte non finie ; coût d'évaluation réglable | code relu, chemins testés |

## Reste à faire (de votre côté)

- [ ] Finir le pré-entraînement v2 (commandes dans `llm/README.md`, ~70 min)
- [ ] Affinage FR v2 puis promotion de `nexus-llm-best.npz` (idem, ~35 min)
- [ ] Compléter `RESULTS.md` avec les chiffres et échantillons v2

## Améliorations code — passe 2 (qualité modèle & génération, testées)

| Amélioration | Détail | Preuve |
|---|---|---|
| Dropout | `--dropout`, masques Bernoulli en mode `training=True` seulement (embedding + sorties de blocs) | éval déterministe == forward_np ; gradient traverse |
| Label smoothing | `--label-smoothing`, cible (1−ε)·one-hot + ε/V dans la cross-entropy | gradient vérifié numériquement : 4,4×10⁻¹⁰ |
| AdamW | décroissance découplée réservée aux matrices (`decay_param_ids`), biais/LN épargnés | test unitaire à gradient nul |
| Plannings LR | `--lr-schedule cosine\|constant\|linear` | test unitaire des trois courbes |
| Beam search | `beam_search` déterministe sur cache KV batché (faisceaux en lockstep, cache réordonné) | largeur 1 ≡ glouton (test) ; démo sur checkpoint v2 |
| Min-p | seuil relatif à p_max dans `filter_logits`, exposé CLI/serveur/API | test des filtres |
| Tokenizer nombres | chiffres découpés un par un (généralisation aux nombres inconnus) ; tokenizer_v2 réentraîné | « 2026 » -> 2·0·2·6, aller-retour exact |
| Corpus v2 mélangé | documents permutés (graine 42) : la validation couvre tous les domaines | `data --v2` régénéré |
| Chargement durci | message explicite si poids et .json sont désappariés (incident réel réparé) | les 5 checkpoints du dépôt rechargés un par un |

Note génération (checkpoint v2 étape 100, sous-entraîné) : à ce stade les
faisceaux dégénèrent sur « de de de… » (chemin le plus probable d'un
modèle qui ne sait encore rien) — l'échantillonnage reste préférable
tant que la perplexité n'est pas descendue.

## Passe 3 — modèle de conversation v2 (2026-10-22)

Objectif : rendre le modèle de dialogue réellement plus intelligent (contexte
plus long, corpus plus dense, meilleur retrieval), sans sortir du 100 % local.

| # | Tâche | État |
|---|-------|------|
| 1 | Contexte 352 → 704, dim 64 → 128, 3 → 4 couches, 4 → 8 têtes (899 968 p) | ✅ exporté |
| 2 | Budgets d'invite H/Q/C/R revus (90/110/260/220) + garde-fou de taille dans `chatPrompt` | ✅ |
| 3 | Corpus dense v2 : 854 exemples / 241 641 caractères (reformulations, mémoire courte, passages entiers) | ✅ |
| 4 | Pré-entraînement prose française (364 473 caractères) puis affinage conversation | ✅ 3 000 pas, 55 min |
| 5 | Validation NLL forcée + top-3, meilleur point de contrôle restauré avant export | ✅ NLL 2,5055 · top-3 50 % |
| 6 | Évaluation v1/v2 sur le même jeu (`scripts/eval-chat.ts`) | ✅ 2,426 → 2,407 |
| 7 | Garde-fous recalibrés sur v2 (`scripts/calibrate-chat.ts`) | ⚠️ 0/16 acceptées — seuils conservés |
| 8 | Retrieval dialogue : IDF, relances hors historique, filtres de bruit sur les radicaux | ✅ 63 % → 99 % top-1 |
| 9 | Retrieval connaissances : poids du titre 0,25 → 0,35, bruit de requête stemmé | ✅ 91 % → 97 % top-1 |
| 10 | Scripts de mesure permanents (`check-dialogue.ts`, `check-retrieval.ts`) | ✅ |
| 11 | Copies scratch `.retrieval*.ts`, `.speed*.ts`, `.bench.ts`, `.t.ts` supprimées | ✅ |

Reste ouvert : la copie du contexte n'est pas apprise à cette échelle. Prochain
levier réaliste = plus de pas sur un modèle plus petit (le coût par pas varie
comme dim² × ctx²), ou une architecture de copie explicite (pointeur) — documenté
dans `RESULTS.md`.
