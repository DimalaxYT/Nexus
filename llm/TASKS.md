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
