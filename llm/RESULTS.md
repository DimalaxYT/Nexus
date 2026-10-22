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

## Modèle de conversation v2 — mesures réelles (2026-10-22)

Modèle livré : `public/models/nexus-chat-v2.{bin,json}` — **899 968 paramètres**,
dim 128, 4 couches, 8 têtes, contexte 704, vocabulaire caractère 145
(lexique 2 345 mots), entraîné par `llm/train_nexus_chat.py` (NumPy, 2 CPU).

| Étape | Donnée | Résultat |
|---|---|---|
| Corpus | `scripts/export-chat-corpus.ts` | 854 exemples / 241 641 caractères · 785 train / 69 validation |
| Pré-entraînement | prose française, 364 473 caractères | 600 pas, perte 2,51 |
| Affinage conversation | blocs de 704, lot 2 | 2 400 pas, perte 2,30 → 1,81 (train) |
| Validation (NLL forcée) | 69 exemples tenus à l'écart | 4,29 → **2,5055** au pas 600, puis 2,61 (surapprentissage) |

Le meilleur point de contrôle (NLL 2,5055) est restauré avant l'export ; durée
totale mesurée : **3 312 s** (55 min) pour 3 000 pas.

> Note de reproductibilité : le corpus a été ré-exporté juste après le lancement
> de l'entraînement avec une découpe sur les mots (lignes `H:`/`Q:`), d'où 241 824
> caractères contre 241 641 utilisés par le run. Les réponses (`R:`) sont
> identiques ; l'écart de 183 caractères ne porte que sur les invites.

### Comparaison honnête v1 / v2 (`scripts/eval-chat.ts`, 12 exemples de validation)

| Mesure | v1 (178 k, ctx 352) | v2 (900 k, ctx 704) |
|---|---|---|
| NLL forcée de la réponse | 2,426 | **2,407** |
| caractères dans le top-3 | 53 % | **54 %** |
| réponses acceptées par les garde-fous | 0/12 | 0/12 |
| F1 de mots avec l'attendu | 0,08 | 0,06 |
| latence par réponse (2 CPU) | 144 ms | 463 ms |

`scripts/calibrate-chat.ts --seed --model nexus-chat-v2` : **0/16 acceptées**
(NLL médiane 1,86 des refusées, couverture lexicale maximale 0,25, NLL de
référence à froid 2,22). Conclusion mesurée : v2 modélise mieux le français
mais n'apprend pas la copie du contexte à cette échelle. Un essai contrôlé de
copie pure (230 passages, 1 500 pas, dim 64) plafonne à **47 % de top-3** —
c'est un budget de calcul, pas un réglage.

### Ce qui a réellement progressé : le retrieval

| Mesure (`scripts/`) | Avant | Après |
|---|---|---|
| `check-dialogue.ts` — question canonique, top-1 | 63 % (117/186) | **99 % (185/186)** |
| `check-dialogue.ts` — mots-clés, top-1 | — | **100 % (186/186)** |
| `check-retrieval.ts` — question, top-1 | 91 % (31/34) | **97 % (33/34)** |
| `check-retrieval.ts` — mots-clés, top-1 | — | **100 % (34/34)** |

Correctifs : pondération IDF des mots-clés de dialogue (un mot rare pèse plus
qu'un mot-outil), exclusion des entrées de relance hors historique, et filtre
de bruit de requête appliqué sur les RADICAUX (« fonctionne » → « fonctionn »)
— il ne retirait presque rien auparavant. Poids du titre dans le classement
des passages ajustés (0,60/0,25 → 0,55/0,35), mesurés sur les 34 entrées.

### Vérification de bout en bout (`scripts/check-chat-e2e.mjs`, serveur de dev réel)

Six tours envoyés à `POST /api/agent` (compte `dev`) sous le modèle v2 livré :
salutation, identité, capacités, humeur, relance, remerciement. Les six
réponses servies sont les bonnes entrées de la banque de dialogue (provenance
« savoir local retrouvé » : la génération n'a pas passé les garde-fous).
Latence : **1,85 s au pire** pour le premier tour (le temps que le disjoncteur
s'ouvre après quatre refus), puis **29–76 ms** par tour — le retrieval seul.

## Round 22 — le savoir servi par le chat (2026-10-22, après-midi)

Le modèle n'a **pas** été réentraîné ce round : les mesures ci-dessus montrent
que son plafond est un budget de calcul, pas un réglage. Le levier restant était
le savoir *servi* — ce que l'utilisateur reçoit quand les garde-fous refusent la
génération, c'est-à-dire presque toujours.

### NEXUS ne savait pas décrire son propre fonctionnement

Questions sur le projet, avant ce round (retrieval seul) :

| Question | Score obtenu | Réponse servie |
|---|---|---|
| « Qu'est-ce que Turso ? » | 0,01 | un conseil de raisonnement |
| « Comment fonctionne le cache clé-valeur ? » | 0,28 | un extrait d'apprentissage Dev |
| « Comment installer NEXUS ? » | 0,72 | une réponse hors sujet |
| « Comment fonctionne GitHub ? » | 0,01 | un extrait sans rapport |
| « Qu'est-ce que la mémoire longue ? » | 0,30 | « Oui, je garde une mémoire longue… » |

C'était un **trou de contenu**, pas un problème de classement : aucune fiche ne
décrivait Turso, le cache, l'installation, GitHub, la mémoire longue, le
pipeline, le modèle, les agents, les connexions ou la sécurité.
`src/lib/brain/project-knowledge.ts` ajoute ces **12 fiches** (37 passages, 315
au total), volontairement **hors du corpus d'entraînement** pour que les
mesures v1/v2 restent comparables. Auto-retrieval : **10/10** ; les questions
réelles donnent 0,89–0,96 (« Qu'est-ce que Turso ? » 0,89, cache 0,90,
installation 0,75).

### Classement en deux temps (entrée, puis phrase)

Classer directement les phrases faisait gagner la phrase d'une AUTRE entrée qui
partageait un mot : « Un peu de motivation » tombait sur « ce qui te motive »
d'un conseil de programmation (0,56 contre 0,35). Désormais : on choisit
d'abord l'ENTRÉE (question + mots-clés + mots-clés déclencheurs), puis la
phrase la plus proche *dans* cette entrée. Effet secondaire voulu : la réponse
commence par la définition de l'entrée et non par une phrase du milieu.

Trois portes anti-hors-sujet, mesurées sur 6 questions hors domaine :

| Question hors sujet | Avant | Après |
|---|---|---|
| « capitale du Kazakhstan en 1723 » | phrase sur le Japon (0,42) | refus honnête |
| « recette du couscous royal » | définition d'algorithme (0,42) | refus honnête |
| « qui a gagné la coupe du monde 1998 ? » | piliers d'un langage (0,25) | refus honnête |
| « combien coûte une Tesla Model 3 ? » | fiche sur le modèle de langue (0,36) | refus honnête |
| « quel temps fera-t-il demain ? » | conseil d'organisation, mot « temps » (0,56) | réponse « je n'ai pas de capteur » |
| « asdf qwer zxcv 1234 » | aucun passage | aucun passage |

Règles : les 2 radicaux les plus spécifiques de la question doivent être
retrouvés (à 50 % en poids IDF) ; un nom propre cité doit l'être aussi — et s'il
est **absent du corpus** (« Tesla », « Kazakhstan »), c'est un refus, pas une
approximation ; un mot-clé déclencheur ne compte que s'il est rare (IDF ≥ 3).

Quand rien ne répond : « Cette information n'est pas dans ma base locale, et je
ne veux pas te raconter n'importe quoi… » au lieu d'un passage voisin.

### Souvenirs et notes passent avant le savoir générique

« Retiens que mon chat s'appelle Pixel » puis « Comment s'appelle mon chat ? »
répondait « NEXUS. C'est le nom qu'on m'a donné » : les souvenirs n'ont pas de
titre, et le classement par entrée les ignorait. Ils sont maintenant comparés à
égalité avec la meilleure entrée, servis sous la forme « D'après ce que tu m'as
dit : « mon chat s'appelle Pixel » », et le cache de passages (60 s) est purgé à
chaque écriture — sans ça la note mettait jusqu'à une minute à devenir visible.

### Harnais permanent et résultats

`scripts/check-chat-knowledge.ts` : 24 questions (11 naturelles, 8 sur NEXUS,
5 hors sujet), plus 2 souvenirs avec `--user`. Mesuré sur le commit précédent
(`4ab2447`) puis sur ce round :

| Famille | Avant | Après |
|---|---|---|
| Questions naturelles | 8/11 | **11/11** |
| Questions sur NEXUS | 0/8 | **8/8** |
| Hors sujet → refus | 0/5 | **5/5** |
| Souvenirs (`--user`) | 2/2 | **2/2** |
| **Total** | **10/26 (38 %)** | **26/26 (100 %)** |

`scripts/check-retrieval.ts` (banque de connaissances, chemin réel
`bestPassage`) : question canonique **34/34 (100 %)**, score moyen 0,83 ;
mots-clés **34/34 (100 %)**. Avant : 33/34 et 34/34 avec un score moyen plus
faible (0,74 / 0,64) — mais l'ancien titre incluait les mots-clés de l'entrée,
ce qui rendait le test des mots-clés circulaire.

`scripts/check-dialogue.ts` : inchangé à 185/186 et 186/186 (les relances et
salutations n'ont pas régressé ; une seule correction : « Merci ! » ne part
plus en relance, « Ça va aujourd'hui ? » non plus).

### Latence réelle (serveur de dev, 2 CPU)

Le disjoncteur s'ouvre après **deux** refus (0/12 et 0/16 mesurés) et une
réponse de score ≥ 0,9 est servie sans générer :

| Tour | Avant | Après |
|---|---|---|
| « Bonjour ! » | 672 ms | **62 ms** |
| « Qu'est-ce que Turso ? » | 4 674 ms | **70 ms** |
| Six tours types (`check-chat-e2e.mjs`) | 1 852 ms au pire | **1 212 ms au pire**, puis 58–92 ms |
| Conversation réelle de 8 tours | 1,3–2,7 s sur 4 tours | 69–79 ms (sauf 1 tour à 1,3 s au démarrage) |

### Reproduire

```bash
node --import tsx scripts/check-chat-knowledge.ts                       # 24/24
node --import tsx scripts/check-chat-knowledge.ts --user <id>           # + souvenirs
node --import tsx scripts/check-retrieval.ts && node --import tsx scripts/check-dialogue.ts
node scripts/check-chat-e2e.mjs --ask "Qu'est-ce que Turso ?|Qui a créé NEXUS ?"
```

## Round 23 — mémoire vivante et personnalité (2026-10-22, soir)

Objectif : un chatbot, pas un moteur de recherche. Il doit **se souvenir de la
personne** (prénom, faits, projets) d'une conversation à l'autre et **parler
comme quelqu'un** — saluer, reprendre le fil, accuser réception de ce qu'on lui
confie. 100 % local : trois lectures en base (compte, souvenirs, conversations),
cache de 30 s, aucun appel réseau.

### Ce qui manquait (mesuré sur `e856fc8`, même script à 5 tours, même base)

| Tour | Avant (`e856fc8`) | Après |
|---|---|---|
| « Bonjour ! » (compte Testeur, conversation précédente « Comment créer un jeu Roblox ») | « Salut ! Content de te voir. De quoi on parle aujourd'hui ? » | « Salut **Testeur** ! Content de te voir. **On reprend sur « Comment créer un jeu Roblox » ?** » |
| « Je m'appelle Camille, j'habite à Lyon et mon chat s'appelle Pixel. » | liste brute à la 3ᵉ personne (« L'utilisateur habite à Lyon et mon chat s'appelle Pixel ») | « Bien noté, **Testeur** ! Je retiens que tu t'appelles Camille, tu habites à Lyon et ton chat s'appelle Pixel… » |
| « Tu te souviens de moi ? » | « Je n'ai rien trouvé dans ta base de connaissances pour « tu te souviens moi ». » | « Je me souviens de toi : tu t'appelles Camille, ton chat s'appelle Pixel et tu habites à Lyon. » |
| « Je travaille sur un jeu de course Roblox. » | tutoriel Roblox générique | « Bien noté, **Camille** ! Je retiens que tu travailles sur un jeu de course Roblox… tu veux qu'on avance dessus ? » |
| « Quel est mon projet, déjà ? » | « Des idées de projets par niveau : Débutant… » | « Je me souviens de toi : tu travailles sur un jeu de course Roblox. » |

### Causes, toutes corrigées à la source

- **Les questions de mémoire n'étaient pas reconnues** : le classifieur envoyait
  « tu te souviens de moi ? » vers la connaissance (72 %), « qui suis-je ? »
  vers les capacités (53 %), « qu'est-ce que tu sais de moi ? » vers le
  smalltalk (40 %). Les motifs `about_user` sont élargis (5/10 → 10/10) et,
  surtout, une **interception avant tout routage** (`isMemoryQuestion`) répond
  sur le contenu retenu — un classifieur ne doit pas pouvoir casser la seule
  question dont la réponse est déjà en base.
- **L'extraction de mémoire se trompait de personne** : « j'habite à Lyon et mon
  chat s'appelle Pixel » produisait « habite à Lyon et mon chat s'appelle
  Pixel », d'où un prénom « Pixel » dans les salutations. Les règles coupent
  désormais la fin de proposition (`clause()`), une règle dédiée retient
  « Son chat s'appelle Pixel », et le prénom n'est lu que dans un souvenir qui
  porte sur la personne (`L'utilisateur s'appelle …`).
- **Rien n'appliquait la mémoire au texte servi** : nouveau module
  `src/lib/llm/personalize.ts` (prénom dans la salutation, continuité entre
  sessions, nom choisi pour l'assistant, ton, aveux adressés), branché sur
  **toutes** les sorties du chat (savoir retrouvé *et* texte généré), plus le
  rappel du dernier sujet de conversation.
- **Les confidences recevaient un tutoriel** : « je travaille sur un jeu de
  course Roblox » déclenchait la fiche Roblox. Une phrase sans question qui
  contient un fait durable reçoit maintenant un accusé de réception et rejoint
  la mémoire (`memoryAck`).

### Mesures

| Harnais | Avant | Après |
|---|---|---|
| `check-chat-knowledge.ts` (sans compte) | 24/24 | **40/40** (16 cas de personnalité) |
| `check-chat-knowledge.ts --user <id>` | 26/26 | **45/45** (5 souvenirs, 16 personnalité, routage) |
| `check-chat-memory.mjs` (nouveau, serveur réel, 2 comptes neufs) | comportements clés absents | **12/12**, pire tour **84 ms** |
| `check-dialogue.ts` | 185/186 · 186/186 | inchangé |
| `check-retrieval.ts` | 34/34 (0,83) · 34/34 (0,62) | inchangé |
| `check-chat-e2e.mjs` six tours | 1 212 ms au pire | **84–108 ms au pire** |

`check-chat-memory.mjs` crée deux comptes neufs à chaque exécution (aucune
pollution) et vérifie : continuité au premier « bonjour », mémorisation d'une
présentation, restitution (« tu te souviens de moi ? », « qui suis-je ? »,
« comment s'appelle mon chat ? »), citation de la dernière conversation,
salutation par le prénom dans une **nouvelle** conversation, absence de
continuité inventée pour un compte vierge, renommage de l'assistant et ton
`direct` (la relance finale tombe).

### Reproduire

```bash
node --import tsx scripts/check-chat-knowledge.ts                        # 40/40
node --import tsx scripts/check-chat-knowledge.ts --user <id>            # 45/45
node scripts/check-chat-memory.mjs                                        # 12/12 (serveur requis)
```

### Ce que le modèle n'a pas fait cette passe

Le modèle de conversation v2 est **inchangé** : ses 0/12 générations acceptées
n'autorisent pas à lui confier la personnalité (une salutation « Salut, je suis
un assistant » sans prénom aurait suffi à casser l'effet). La personnalisation
s'applique donc au texte **servi**, sans rien inventer : elle ne crée aucun
fait, elle met en forme ceux qui existent. Le prochain levier reste la
génération (budget de calcul, voir Round 21).
