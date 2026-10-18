# Nexus LLM — Résultats mesurés

Toutes les valeurs ci-dessous sont réelles (journaux d'entraînement du
dépôt, génération reproductible à graine fixe). Aucun échantillon n'a été
retouché.

## Preuves de correction (avant tout entraînement)

| Vérification | Résultat |
|---|---|
| Gradients autograd vs différences finies (matmul, LayerNorm, softmax, embedding, cross-entropy) | erreur max **5,1×10⁻¹⁰** |
| Gradients des primitives fusionnées (attention, GELU) | erreur max **5,9×10⁻¹⁰** |
| Tokenizer BPE : aller-retour encode→décoder | exact, y compris accents, emoji et caractères jamais vus (byte-level) |
| Sur-apprentissage d'un lot unique (60 étapes) | perte **4,60 → 0,004** : le modèle apprend, rien n'est codé en dur |
| Perte initiale du vrai modèle | 7,71 ≈ ln(2049) = 7,62 : l'initialisation est saine |

## Entraînement (2 CPU, NumPy, ~785 Mo de RSS après correctifs)

| Phase | Données | Étapes | Perte train | Perte val. | Perplexité val. |
|---|---|---|---|---|---|
| 1. Pré-entraînement | FR Nexus + Tiny Shakespeare, 635 287 tokens | 750 | 7,71 → 3,61 | 6,91 → 3,65 | 999 → 38,6 |
| 2. Affinage FR | français brut (markdown + phrases extraites des .ts) | +400 | → 3,44 | 4,12 → 3,65 | 61,6 → 38,6 |
| 3. Affinage FR propre | prose nettoyée (code/lien/tableaux retirés) | +600 | → 3,04 | 3,60 → 3,21 | 36,6 → **24,7** |

Total : **1 750 étapes**, ~3,5 M de tokens vus, ~85 minutes CPU cumulées.
Modèle final : 5 329 152 paramètres, `checkpoints/nexus-llm.npz`
(le pré-entraîné mixte est conservé : `nexus-llm-base.npz`).

## Échantillons générés (verbatim, graine fixe)

Modèle final, prompt « Bonjour, je suis » (température 0,8) :

> Bonjour, je suis une nones
> une un de un un une moi le a un pour un de de de ${
> recherche pour une condu la 3d le la du monta un un moi je pour sans page (…)

Modèle de base, prompt « To be, or not to » (température 0,8) :

> To be, or not to for the to I but the this, me be you your be the your my and is that in and the with he 'll so do do the be (…)
>
> Nurse:
> He you this me me him.
>
> AUFIDIUS:
> I I

## Lecture honnête des résultats

Le modèle a réellement appris la statistique de son corpus : vocabulaire
Nexus (« agents », « conversations », « recherche », « connaissances »),
balises de locuteurs shakespeariennes (`Nurse:`, `AUFIDIUS:`), mots-outils
français enchaînés correctement, néologismes morphologiquement plausibles
(« détraire », « nones »). En revanche, à **5 M de paramètres** entraînés
sur **~1 Mo de texte technique fragmenté** (un changelog, pas de la prose
littéraire), il ne produit pas de phrases longues cohérentes : c'est le
résultat scientifiquement attendu à cette échelle — GPT-2 a vu ~40 Go de
texte avec 124 M de paramètres. Le mode glouton dégénère en boucles
(« (3 (3 (3… »), artefact connu des petits modèles.

Ce qui est démontré ici n'est donc pas « un concurrent de ChatGPT », mais
exactement ce qui était demandé : **un vrai LLM, complet et de zéro** —
tokenizer, autodifférentiation prouvée, architecture GPT, apprentissage
par gradient mesuré, génération, serveur local et intégration à Nexus —
sans Ollama, sans API, sans poids téléchargés.

## Incidents d'ingénierie rencontrés et résolus (détail dans le code)

1. **OOM à l'étape 1** : le GELU composé retenait ~9 tenseurs/couche →
   primitives fusionnées (attention style FlashAttention, GELU/ReLU à
   recalcul) et libération des intermédiaires pendant le backward.
2. **Promotion float64 silencieuse (NEP 50)** : un scalaire `np.float64`
   doublait mémoire et temps de tout le flux résiduel → `float()` Python
   + test garde-fou sur le dtype des logits.
3. **Pic de ~3 Go dans `evaluate()`** : les graphes forward forment des
   cycles libérés par le GC (qui compte les objets, pas les octets) →
   `gc.collect()` par lot, cycles cassés dans `backward()`,
   `malloc_trim` périodique. Pic final : **785 Mo**.

## Reproduire

```bash
cd llm && pip install -r requirements.txt
python tests/test_autograd.py && python tests/test_tokenizer.py && python tests/test_model.py
python -m nexus_llm.generate --prompt "Bonjour, je suis" --seed 7   # utilise le checkpoint livré
python -m nexus_llm.serve --port 8765                               # puis GET /api/llm côté Nexus
```
