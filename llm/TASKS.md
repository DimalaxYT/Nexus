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
