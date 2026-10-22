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

## Passe 4 — le savoir servi (2026-10-22, après-midi)

Objectif : sans réentraîner le modèle (son plafond est un budget de calcul,
mesuré), rendre **plus intelligentes les réponses que l'utilisateur reçoit
vraiment** — c'est-à-dire celles qui viennent du retrieval.

| # | Tâche | État |
|---|-------|------|
| 1 | Documentation du projet interrogeable (12 fiches : Turso, cache, installation, GitHub, mémoire longue, pipeline, modèle, agents, connexions, sécurité, création, injections) | ✅ `project-knowledge.ts`, hors corpus |
| 2 | Classement en deux temps : entrée (question + mots-clés) puis phrase dans l'entrée | ✅ 34/34 question, 34/34 mots-clés |
| 3 | Titre = question de l'entrée (mots-clés devenus déclencheurs) | ✅ teste enfin le classement au lieu de le rendre circulaire |
| 4 | Portes anti-hors-sujet : 2 radicaux les plus spécifiques, entités nommées, mot-clé rare (IDF ≥ 3) | ✅ 5/5 refus, 0/5 avant |
| 5 | Réponse = entrée entière coupée proprement (260 car.), au lieu d'une phrase isolée | ✅ |
| 6 | Souvent comparés à égalité avec les entrées + purge du cache à l'écriture | ✅ « mon chat s'appelle Pixel » |
| 7 | Relances : retirer les blocs `[Suivi : …]` avant la recherche ; « Merci ! » n'est plus une relance | ✅ |
| 8 | Harnais `check-chat-knowledge.ts` (24 questions + souvenirs) | ✅ 10/26 → 26/26 |
| 9 | Latence : disjoncteur après 2 refus, savoir exact servi sans générer | ✅ 1 852 ms → 92 ms au pire |
| 10 | E2E `--ask` pour interroger le projet en réel | ✅ 27–101 ms |

Prochaine marche à franchir (mesurée, pas supposée) : **la génération**. Tant que
le modèle ne sait pas recopier un passage (0/12 et 0/16 acceptées), NEXUS sert
le savoir retrouvé. Les deux leviers chiffrés dans `RESULTS.md` : un budget de
calcul très supérieur (une tête d'induction sur 700 caractères ne s'installe pas
en 3 000 pas) ou un objectif de copie découpé (recopie par segments plutôt
qu'en une passe).

## Passe 5 — mémoire vivante et personnalité (2026-10-22, soir)

Objectif : ne plus « avoir une mémoire » mais **s'en servir dans la réponse
affichée**, et parler comme quelqu'un (prénom, continuité, ton, aveux adressés).
Aucun réentraînement : le modèle v2 n'est pas assez fiable (0/12 acceptées) pour
porter la voix de NEXUS — la personnalisation s'applique au texte servi.

| # | Tâche | État |
|---|-------|------|
| 1 | Module `personalize.ts` : charge compte + 40 souvenirs + 4 conversations, cache 30 s, invalidation à l'écriture | ✅ |
| 2 | Prénom dans la salutation et les aveux ; nom choisi pour l'assistant | ✅ « Salut Camille ! », « Camille, je ne trouve pas… » |
| 3 | Continuité entre sessions : « On reprend sur « <dernier sujet> » ? » (conversation en cours exclue) | ✅ titre réel cité |
| 4 | Questions de mémoire interceptées AVANT le classifieur | ✅ 5 questions mal routées → 10/10 |
| 5 | Résumé de mémoire à la 2ᵉ personne, filtré par sujet (projet, animaux, ville, prénom, âge) | ✅ « tu t'appelles Camille, ton chat s'appelle Pixel et tu habites à Lyon » |
| 6 | Dernière conversation citée en toutes lettres | ✅ « La dernière fois, on parlait de « … » » |
| 7 | Confidences (« je travaille sur… ») : accusé de réception + mémorisation, au lieu d'un tutoriel | ✅ `memoryAck` |
| 8 | Extraction de mémoire corrigée (fin de proposition, animal ≠ prénom) | ✅ « Son chat s'appelle Pixel » |
| 9 | Ton `direct` : la relance finale tombe (regex cassée, réécrite) | ✅ |
| 10 | Harnais : `check-chat-memory.mjs` (2 comptes neufs, 12 vérifications) + famille « personnalité » dans `check-chat-knowledge.ts` | ✅ 12/12, 45/45 |
| 11 | `conversationId` transmis du client au cerveau | ✅ `AgentChat.tsx` → `/api/agent` → `processTurn` |

Prochaine marche : **la voix du modèle**. Tant que 0/12 générations passent les
garde-fous, la personnalité restera plaquée sur le savoir retrouvé. Deux leviers
chiffrés : budget de calcul (une tête d'induction sur 700 caractères demande
bien plus de 3 000 pas) ou génération par segments avec recopie guidée.
