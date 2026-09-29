// ─── NEXUS Brain — Banque de connaissances intégrée (savoir hors-ligne) ───────
// Le cerveau local répond aux questions générales courantes SANS API :
// science, programmation, Roblox/Luau, histoire, géographie, NEXUS lui-même.

import { stems } from './text'
import { semanticSimilarity } from './neural'

export interface KnowledgeEntry {
  keywords: string[] // mots-clés déclencheurs (normalisés, sans accents)
  question: string
  answer: string // markdown
}

export const NEXUS_KNOWLEDGE: KnowledgeEntry[] = [
  // ── Roblox / Luau (le cœur d'usage de l'utilisateur) ────────────────────────
  {
    keywords: ['roblox', 'luau', 'script', 'studio', 'jeu roblox'],
    question: 'Comment créer un jeu Roblox ?',
    answer: `**Créer un jeu Roblox, les fondamentaux :**

1. **Roblox Studio** — télécharge-le depuis roblox.com/create. Tout se passe là.
2. **Luau** — c'est le langage de script (dérivé de Lua, plus rapide et typé).
3. **Structure du jeu** :
   - \`Workspace\` : tout ce qui est visible dans le monde
   - \`ServerScriptService\` : tes scripts serveur (logique du jeu)
   - \`StarterPlayerScripts\` : scripts côté joueur
   - \`ReplicatedStorage\` : objets partagés client/serveur (RemoteEvents…)
4. **Premier script** — dans ServerScriptService :
\`\`\`lua
local part = Instance.new("Part")
part.Size = Vector3.new(4, 1, 4)
part.Position = Vector3.new(0, 5, 0)
part.Anchored = true
part.Parent = workspace
print("Mon premier bloc !")
\`\`\`
5. **Tester** : bouton ▶ Play (ou F5).

**Conseil** : commence petit (obby, tycoon simple), publie via Fichier → Publier sur Roblox. Demande-moi un script précis (pièces, kill bricks, téléporteurs…) et je te l'écris !`,
  },
  {
    keywords: ['remote', 'event', 'client', 'serveur', 'communication'],
    question: 'RemoteEvents : communication client ↔ serveur',
    answer: `**RemoteEvent** relie le client et le serveur (indispensable en Roblox, car le client ne fait pas confiance) :

\`\`\`lua
-- ReplicatedStorage : RemoteEvent nommé "AcheterItem"
local remote = game.ReplicatedStorage.AcheterItem

-- CÔTÉ CLIENT (LocalScript) — demande un achat
remote:FireServer("epee_legendaire")

-- CÔTÉ SERVEUR (Script dans ServerScriptService) — valide et exécute
remote.OnServerEvent:Connect(function(joueur, itemId)
    if type(itemId) ~= "string" then return end
    local prix = PRIX[itemId]
    local argent = joueur.leaderstats.Argent
    if argent and argent.Value >= prix then
        argent.Value -= prix
        -- donner l'item…
    end
end)
\`\`\`

**Règle d'or** : JAMAIS confiance au client. Le serveur vérifie toujours (prix, distance, cooldown). \`RemoteFunction\` attend une réponse, \`RemoteEvent\` est "fire and forget".`,
  },
  {
    keywords: ['datastore', 'sauvegarde', 'save', 'donnees', 'persist'],
    question: 'DataStore : sauvegarder les données joueur',
    answer: `**DataStoreService** sauvegarde des données entre les sessions :

\`\`\`lua
local DataStoreService = game:GetService("DataStoreService")
local store = DataStoreService:GetDataStore("MonSave")

local function sauvegarder(joueur)
    local ok, err = pcall(function()
        store:SetAsync("joueur_" .. joueur.UserId, {
            argent = joueur.leaderstats.Argent.Value,
            niveau = joueur.Niveau.Value,
        })
    end)
    if not ok then warn("Échec sauvegarde : " .. tostring(err)) end
end

game.Players.PlayerRemoving:Connect(sauvegarder)

-- Au join : charger avec store:GetAsync("joueur_" .. joueur.UserId)
\`\`\`

**Points clés** : toujours \`pcall\` (le réseau échoue parfois), limite ~60 + 10×joueurs requêtes/minute, teste en Studio avec "Enable Studio Access to API Services" dans Game Settings.`,
  },
  {
    keywords: ['tween', 'animation', 'part', 'mouvement', 'bouger'],
    question: 'Animer un objet avec TweenService',
    answer: `**TweenService** anime doucement propriétés, taille, couleur, transparence :

\`\`\`lua
local TweenService = game:GetService("TweenService")
local part = workspace.Porte

local info = TweenInfo.new(
    1.5,                       -- durée (s)
    Enum.EasingStyle.Quad,     -- courbe d'accélération
    Enum.EasingDirection.Out
)
local objectif = { Position = part.Position + Vector3.new(0, 8, 0) }
local tween = TweenService:Create(part, info, objectif)
tween:Play()
\`\`\`

Idéal pour : portes coulissantes, plateformes mobiles, apparitions d'objets, caméras (avec \`CFrame\`). Pour une boucle infinie : \`tween.Completed:Connect(function() tween inversé... end)\`.`,
  },
  {
    keywords: ['leaderstats', 'leaderboard', 'argent', 'monnaie', 'score'],
    question: 'Leaderstats : afficher argent/score',
    answer: `**Leaderstats** = le panneau en haut à droite de chaque joueur :

\`\`\`lua
-- Script dans ServerScriptService
game.Players.PlayerAdded:Connect(function(joueur)
    local stats = Instance.new("Folder")
    stats.Name = "leaderstats"
    stats.Parent = joueur

    local argent = Instance.new("IntValue")
    argent.Name = "Argent"      -- le nom affiché à l'écran
    argent.Value = 100          -- argent de départ
    argent.Parent = stats
end)

-- Ajouter de l'argent n'importe où :
-- joueur.leaderstats.Argent.Value += 10
\`\`\`
Pour un classement global (top serveur), ajoute un \`SurfaceGui\` avec une liste triée, mise à jour périodiquement.`,
  },

  // ── Programmation générale ──────────────────────────────────────────────────
  {
    keywords: ['algorithme', 'qu est ce qu un algorithme'],
    question: 'Qu’est-ce qu’un algorithme ?',
    answer: `Un **algorithme** est une suite d'instructions finies et non ambiguës pour résoudre un problème — une recette de cuisine, version informatique.

**Exemple : trouver le plus grand nombre d'une liste**
1. Prends le premier élément comme "record"
2. Parcours les suivants : si un élément dépasse le record, il devient le record
3. À la fin, le record est la réponse

**Propriétés importantes** : terminaison (il doit s'arrêter), correction (bonne réponse), efficacité (on mesure en **complexité** — O(n) = proportionnel à la taille des données, O(log n) = très rapide, O(n²) = à éviter sur de gros volumes).

Les classiques à connaître : recherche dichotomique, tris rapide/fusion, parcours de graphes (BFS/DFS), programmation dynamique.`,
  },
  {
    keywords: ['git', 'versioning', 'commit'],
    question: 'Git : les bases du versioning',
    answer: `**Git** enregistre l'historique de ton code — tu peux tout expérimenter sans risque.

\`\`\`bash
git init                 # démarrer un dépôt
git status               # ce qui a changé
git add .                # préparer les fichiers
git commit -m "Ajout du menu"  # point de restauration
git log --oneline        # historique
git checkout -b ma-branche     # branche expérimentale
git merge ma-branche     # fusionner
git push                 # envoyer sur GitHub
\`\`\`

**Le réflexe pro** : une branche par fonctionnalité, des commits petits et fréquents, messages clés en main ("Corrige le spawn des pièces" plutôt que "fix").`,
  },
  {
    keywords: ['variable', 'fonction', 'boucle', 'condition', 'apprendre programmer', 'debutant code'],
    question: 'Les bases de la programmation',
    answer: `**Les 4 piliers de tout langage :**

1. **Variables** — des boîtes étiquetées : \`score = 0\`
2. **Conditions** — des embranchements : \`if score > 100 then gagne() end\`
3. **Boucles** — de la répétition : \`for i = 1, 10 do print(i) end\`
4. **Fonctions** — des briques réutilisables :
\`\`\`lua
local function ajouterBonus(score, bonus)
    return score + bonus
end
\`\`\`

**Comment progresser vite** : code TOUS les jours (même 20 min), commence par des mini-projets qui te motivent (un jeu Roblox !), lis les erreurs calmement (elles disent toujours la ligne et le problème). Demande-moi un exercice adapté à ton niveau !`,
  },
  {
    keywords: ['internet', 'reseau', 'comment marche internet', 'web'],
    question: 'Comment fonctionne Internet ?',
    answer: `**Internet** = un réseau mondial de machines qui s'échangent des paquets de données.

**Le trajet d'une page web** :
1. Ton navigateur demande \`exemple.com\` → le **DNS** traduit le nom en adresse IP (comme un annuaire)
2. Ta requête part, découpée en **paquets**, saute de routeur en routeur (TCP/IP)
3. Le serveur répond (page HTML) → ton navigateur l'affiche, charge CSS + JS + images

**Couches essentielles** : IP (adresser les machines), TCP (livraison fiable), HTTP/HTTPS (le langage du web, chiffré quand il y a le S), DNS (annuaire).

**Chiffre clé** : le trajet complet prend typiquement 10-100 ms ! Demande-moi le détail d'une couche si ça t'intéresse.`,
  },
  {
    keywords: ['intelligence artificielle', 'ia', 'machine learning', 'apprentissage'],
    question: 'Comment fonctionne l’intelligence artificielle ?',
    answer: `**L'IA moderne, expliquée simplement :**

- **Machine learning** : au lieu de programmer des règles, on montre des EXEMPLES et le modèle apprend tout seul les régularités statistiques.
- **Réseaux de neurones** : des couches de "neurones" mathématiques. Chaque neurone = multiplication + somme + seuil. Empilées, ces couches apprennent des concepts de plus en plus abstraits (bords → formes → visages).
- **Entraînement** : on montre des millions d'exemples, le modèle devine, on mesure l'erreur (**loss**), et on corrige les poids par **rétropropagation** + **descente de gradient**.
- **LLM** (comme les grands modèles de langage) : un réseau géant entraîné à prédire le mot suivant sur d'énormes corpus — ce qui produit émergent compréhension, traduction, raisonnement…

**Fun fact** : le cerveau de NEXUS ici utilise un vrai petit réseau de neurones codé from scratch (rétropropagation + Adam) pour comprendre tes intentions — 0 API, 100 % mathématiques locales !`,
  },

  // ── Science générale ────────────────────────────────────────────────────────
  {
    keywords: ['ciel', 'bleu', 'pourquoi le ciel est bleu'],
    question: 'Pourquoi le ciel est-il bleu ?',
    answer: `Le ciel est bleu à cause de la **diffusion de Rayleigh** : la lumière du Soleil contient toutes les couleurs. En traversant l'atmosphère, elle percute les molécules d'air (N₂, O₂) qui la renvoient dans toutes les directions.

**Le point clé** : la diffusion est beaucoup plus forte pour les **courtes longueurs d'onde** (bleu ~450 nm) que pour les longues (rouge ~700 nm) — proportionnelle à 1/λ⁴. Le bleu est donc dispersé partout dans le ciel → nos yeux le voient venir de toutes les directions.

**Et le coucher de soleil ?** La lumière traverse alors une couche d'air bien plus épaisse : le bleu est diffusé en route, il ne reste que les rouges et oranges qui arrivent directement à nos yeux.`,
  },
  {
    keywords: ['gravite', 'gravitation', 'pesanteur'],
    question: 'Qu’est-ce que la gravité ?',
    answer: `La **gravité** est l'attraction universelle entre tout ce qui possède de la masse ou de l'énergie.

**Newton (1687)** : deux corps s'attirent proportionnellement à leurs masses, inversement au carré de la distance. \`F = G·m₁·m₂/d²\`. Ça décrit tout, de la pomme à la Lune.

**Einstein (1915, relativité générale)** : la gravité n'est pas une force mais une **courbure de l'espace-temps**. La masse déforme l'espace autour d'elle comme une boule sur un drap tendu ; les autres corps suivent simplement les courbes.

**Conséquences concrètes** : les orbites, les marées, le temps qui passe plus vite en altitude (GPS corrigé !), les trous noirs (courbure extrême).`,
  },
  {
    keywords: ['trou noir', 'black hole'],
    question: 'Qu’est-ce qu’un trou noir ?',
    answer: `Un **trou noir** est une région où la matière est si concentrée que rien ne s'échappe — pas même la lumière.

**Naissance** : une étoile massive (>20 soleils) s'effondre sur elle-même en fin de vie. Sa densité devient infinie en un point : la **singularité**.

**L'horizon des événements** : la frontière de non-retour. Vitesse d'évasion nécessaire > vitesse de la lumière → rien ne sort.

**Faits marquants** :
- Sagittarius A*, au centre de notre galaxie : 4 millions de masses solaires
- Le temps ralentit près d'un trou noir (dilatation gravitationnelle)
- Première image : M87* en 2019 (Event Horizon Telescope)
- Ils s'évaporent très lentement par **radiation de Hawking**`,
  },
  {
    keywords: ['big bang', 'origine univers', 'univers'],
    question: 'Qu’est-ce que le Big Bang ?',
    answer: `Le **Big Bang** désigne l'état extrêmement dense et chaud d'où l'Univers observable a évolué, il y a **13,8 milliards d'années**.

**Chronologie express** :
- t = 0 : singularité (toute la matière-énergie comprimée)
- 10⁻³² s : inflation — expansion exponentielle fulgurante
- 3 minutes : les premiers noyaux (hydrogène, hélium)
- 380 000 ans : l'Univers devient transparent (fond diffus cosmologique — on le capte encore !)
- ~200 millions d'années : premières étoiles
- Aujourd'hui : expansion qui **accélère** (énergie noire)

**Preuves solides** : le fond diffus cosmologique (1965), la fuite des galaxies (loi de Hubble), l'abondance primordiale d'hélium.

⚠️ Précision : ce n'est pas une "explosion dans l'espace" mais **l'expansion de l'espace lui-même**.`,
  },
  {
    keywords: ['photosynthese', 'plantes', 'chlorophylle'],
    question: 'Qu’est-ce que la photosynthèse ?',
    answer: `La **photosynthèse** : les plantes fabriquent leur nourriture avec la lumière.

\`\`\`text
6 CO₂ + 6 H₂O + lumière → C₆H₁₂O₆ (glucose) + 6 O₂
\`\`\`

**Où** : dans les **chloroplastes** des feuilles, grâce à la **chlorophylle** (le pigment vert qui capte le rouge et le bleu — il réfléchit le vert, d'où la couleur).

**En deux actes** :
1. **Phase lumineuse** : la lumière casse l'eau → oxygène rejeté + énergie stockée (ATP)
2. **Cycle de Calvin** : cette énergie fixe le CO₂ de l'air en sucre

**Pourquoi c'est vital** : cette réaction produit l'oxygène que tu respires ET toute la base des chaînes alimentaires. Chaque gramme de bois, c'est du CO₂ de l'air transformé en matière.`,
  },
  {
    keywords: ['mer', 'salee', 'sel', 'ocean'],
    question: 'Pourquoi la mer est-elle salée ?',
    answer: `La mer est salée parce que **l'eau lessive les continents depuis 4 milliards d'années** :

1. La pluie (légèrement acide, avec le CO₂) ronge les roches → elle emporte des ions (sodium, chlore, calcium, magnésium…)
2. Les rivières transportent ces ions vers l'océan
3. L'eau s'évapore, les sels **restent** et s'accumulent

**Chiffres** : ~35 g de sel par litre en moyenne (la mer Morte : ~280 g/L !). Si on répandait tout le sel des océans sur les continents : une couche de **150 m d'épaisseur**.

**Le sel ne se dilue pas** car il ne peut que s'accumuler — les océans sont le point bas du cycle de l'eau, et l'évaporation est un distillateur géant qui fonctionne depuis toujours.`,
  },
  {
    keywords: ['volcan', 'eruption', 'magma'],
    question: 'Comment fonctionnent les volcans ?',
    answer: `Un **volcan** crache la roche fondue qui remonte des profondeurs de la Terre.

**Le moteur** : sous la croûte (30 km), le manteau est partiellement fondu (**magma**, 700-1300 °C). Plus léger que la roche solide, il remonte et s'accumule dans des **chambres magmatiques**. Les gaz dissous forment des bulles — quand la pression dépasse la résistance de la croûte : **éruption**.

**Deux familles** :
- **Rouge** (Hawaï) : lave fluide, gaz qui s'échappent paisiblement — volcans-boucliers aux pentes douces
- **Gris** (Vésuve, Pinatubo) : lave pâteuse + gaz coincés → explosions colossales, nuées ardentes

**Fun fact** : la ceinture de feu du Pacifique concentre 75 % des volcans actifs, là où les plaques tectoniques plongent l'une sous l'autre.`,
  },
  {
    keywords: ['sommeil', 'dormir', 'fatigue'],
    question: 'Pourquoi dort-on ?',
    answer: `Le **sommeil** est le mode maintenance du cerveau — on ne "s'éteint" pas, on travaille autrement.

**Ce qui se passe quand tu dors** :
1. **Nettoyage** : le système glymphatique évacue les déchets métaboliques (dont les protéines liées à Alzheimer)
2. **Consolidation mémoire** : l'hippocampe rejoue la journée et transfère l'important vers le cortex — dormir après réviser = mémoriser mieux
3. **Réparation** : hormone de croissance, réparation musculaire, immunité renforcée
4. **Régulation émotionnelle** : sans sommeil, l'amygdale (émotions) surchauffe de ~60 %

**Combien ?** 7-9 h à l'âge adulte. **Le vrai conseil** : régularité (mêmes horaires), lumière du jour le matin, écrans tamisés le soir.`,
  },

  // ── Histoire / géographie ───────────────────────────────────────────────────
  {
    keywords: ['ordinateur', 'inventeur', 'invention', 'histoire informatique', 'premier ordinateur'],
    question: 'Qui a inventé l’ordinateur ?',
    answer: `L'ordinateur est une **œuvre collective** — quelques jalons :

- **1837 — Charles Babbage** : conçoit la Machine analytique (mécanique, mais avec unité de calcul, mémoire, instructions) — **Ada Lovelace** écrit pour elle le premier programme de l'histoire
- **1936 — Alan Turing** : la machine de Turing, fondement théorique de tout calcul
- **1941 — Konrad Zuse** : le Z3, premier ordinateur programmable fonctionnel (relais électromécaniques)
- **1945 — ENIAC** (USA) : premier grand ordinateur électronique universel (18 000 tubes !)
- **1947 — le transistor** (Bell Labs) → miniaturisation
- **1971 — Intel 4004** : premier microprocesseur → l'ordinateur entre dans nos maisons

**À retenir** : Turing pour la théorie, Zuse/ENIAC pour la première réalisation, le transistor pour la révolution.`,
  },
  {
    keywords: ['rome', 'romain', 'empire romain'],
    question: 'L’Empire romain',
    answer: `**Rome** : du village du VIIIᵉ siècle av. J.-C. à l'empire dominant la Méditerranée.

**Dates clés** :
- 753 av. J.-C. : fondation légendaire (Romulus)
- 27 av. J.-C. : Auguste, premier empereur (fin de la République)
- 117 ap. : apogée sous Trajan — 5 millions de km², ~60 millions d'habitants
- 395 : division Est/Ouest ; 476 : chute de l'Empire d'Occident

**Héritage énorme** : droit (base du droit européen), langues romanes (français !), architecture (arcs, béton, aqueducs — le Panthéon tient toujours), réseaux routiers (~80 000 km), le calendrier julien → le nôtre.

**Pourquoi la chute ?** Combinaison : pression des peuples germaniques, crises économiques, divisions politiques, armée de plus en plus "barbarisée". L'Empire d'Orient (Byzance) a tenu jusqu'en 1453.`,
  },
  {
    keywords: ['japon', 'tokyo', 'nippon'],
    question: 'Le Japon en bref',
    answer: `**Le Japon** : archipel de 14 000 îles (4 principales), 125 millions d'habitants, capitale **Tokyo** (~37 M d'habitants avec l'agglomération — la plus peuplée du monde).

**Signature culturelle** : mélange unique de tradition (temples, cérémonie du thé, sumo) et hyper-modernité (animés, robots, shinkansen à 320 km/h).

**Repères** :
- Langue : japonais (3 écritures : hiragana, katakana, kanji)
- Économie : 3ᵉ ou 4ᵉ mondiale — Toyota, Sony, Nintendo
- Gastronomie UNESCO : sushi, ramen, kaiseki
- Nature : 100+ volcans actifs (dont le mont Fuji, 3776 m), saisons très marquées (sakura !)

**Le savais-tu** : Tokyo était autrefois Edo ; après 1868 (ère Meiji), le Japon s'est modernisé en ~30 ans après 250 ans de fermeture.`,
  },
  {
    keywords: ['egypte', 'pyramide', 'pharaon'],
    question: 'L’Égypte antique',
    answer: `**L'Égypte antique** : 3000 ans de civilisation le long du Nil (3150 av. J.-C. → 30 av. J.-C., conquête romaine).

**Pourquoi le Nil ?** Chaque année, ses crues déposent un limon fertile dans le désert → agriculture nourricière. Hérodote : « L'Égypte est un don du Nil ».

**Icônes** :
- **Pyramides** : Kéops (Gizeh, ~2560 av. J.-C.) = 2,3 millions de blocs, la seule des 7 merveilles antiques encore debout
- **Hiéroglyphes** : déchiffrés grâce à la pierre de Rosette (Champollion, 1822)
- **Momification** : préservation du corps pour l'après-vie
- **Pharaons célèbres** : Khéops, Hatchepsout, Toutânkhamon (tombe intacte découverte en 1922 !), Ramsès II`,
  },

  // ── Vie pratique / motivation ───────────────────────────────────────────────
  {
    keywords: ['idee', 'idees', 'projet', 'inspiration'],
    question: 'Des idées de projets',
    answer: `**Des idées de projets par niveau :**

**Débutant (1-2 semaines)**
- Calculatrice / convertisseur d'unités (script Python ou page web)
- Quiz Roblox sur ton jeu préféré (page web HTML)
- Générateur de pseudo aléatoire avec styles

**Intermédiaire (1-2 mois)**
- **Obby Roblox** avec checkpoint + sauvegarde DataStore + leaderboard
- Simulateur de clicking game (tycoon simplifié)
- Bot Discord pour ton serveur (modération, stats)
- Site portfolio de tes créations

**Ambitieux (3+ mois)**
- **Tycoon Roblox complet** : boutique, économie, sauvegarde, passage premium
- Petit jeu 2D complet (Godot/Unity)
- Un outil de productivité (habit tracker) que TU utilises chaque jour

**Ma règle d'or** : choisis un projet qui te fait VIBRER et rends-le jouable/publiable dès que possible — la boucle de feedback crée la motivation. Dis-moi lequel te tente, je te fais un plan d'action !`,
  },
  {
    keywords: ['motivation', 'demotive', 'fatigue', 'triste', 'moral'],
    question: 'Un peu de motivation',
    answer: `**On a tous ces moments-là.** Voici ce qui marche vraiment :

1. **La règle des 5 minutes** : engage-toi à travailler 5 min seulement. 90 % du temps, tu continues — le plus dur c'est de commencer, pas de durer.
2. **Rétrécis la tâche** : "créer mon jeu" est paralysant. "Ajouter le bouton Play du menu" est faisable maintenant.
3. **Note tes victoires** : garde un fichier "fieri.txt" où tu écris chaque chose accomplie. Relis-le les jours sans.
4. **Le contraste** : compare-toi à toi-même il y a 6 mois, pas aux pros de YouTube (leur montage cache 500 heures de galères).
5. **Bouge + lumière** : 10 min de marche et de la lumière du jour font plus que 2 cafés.

**Et n'oublie pas** : la motivation suit l'action, elle ne la précède pas. Tu commences petit → petit progrès → envie de continuer. C'est mécanique, c'est fiable.

Si tu veux, confie-moi une mission (bouton Task) et on découpe ton projet en petites étapes ensemble 💪`,
  },
  {
    keywords: ['organiser', 'temps', 'productivite', 'planning'],
    question: 'Mieux organiser son temps',
    answer: `**Organiser son temps, l'essentiel :**

1. **Le cerveau est mauvais pour retenir** → tout dans un système (liste de tâches, missions NEXUS !). La tête libérée = esprit clair.
2. **Règle des 3** : chaque matin, choisis les 3 tâches qui rendraient la journée réussie. Fais-les d'abord.
3. **Pomodoro** : 25 min de focus + 5 min de pause. 4 cycles puis grande pause. Parfait contre la procrastination.
4. **Découpe** : une tâche qui te fait fuir = une tâche trop grande. Découpe jusqu'à ce que la première étape prenne <15 min.
5. **Regroupe les petites** : mails, messages, petits réglages → un seul créneau par jour, pas en mode "je réponds au fil de l'eau".

**Anti-piège** : la productivité n'est pas remplir sa journée, c'est finir ce qui COMPTE. Une mission terminée > cinq commencées. Essaie le bouton **Task** de NEXUS : nom, durée, objectifs — et on suit l'avancement ensemble.`,
  },
  {
    keywords: ['blague', 'fais moi rire', 'drole'],
    question: 'Une blague',
    answer: `Voici ma sélection (réseau de neurones + humour local, garantie sans API) :

- Pourquoi les développeurs confondent Halloween et Noël ? Parce que **31 OCT = 25 DEC** (en octal !) 🎃🎄
- Un programmeur va faire les courses. Sa femme : « Prends une bouteille de lait, et s'il y a des œufs, prends-en six. » Il revient avec **six bouteilles de lait**. 🥛
- Combien de programmeurs faut-il pour changer une ampoule ? **Aucun, c'est un problème côté matériel.**
- Que dit un Lua à un Lua ? « *On se local() verra !* »
- Pourquoi le robot est allé chez le médecin ? Il avait un **bug** dans le ventre. 🤖

Tu en veux d'autres, ou on retourne construire quelque chose de génial ? 😉`,
  },
  {
    keywords: ['langage apprendre', 'quel langage', 'commencer programmation', 'premier langage'],
    question: 'Quel langage de programmation apprendre ?',
    answer: `**Dépend de ton objectif — la seule vraie question :**

- **Je veux créer des jeux Roblox** → **Luau** (tu fais des mods réels dès le jour 1, et le studio Roblox est gratuit)
- **Automatiser, data, IA** → **Python** (le plus lisible pour débuter, écosystème géant)
- **Sites web** → HTML + CSS puis **JavaScript** (le seul langage du navigateur)
- **Jeux pro multiplateformes** → C# (Unity) ou C++ (Unreal)
- **Fondations solides et portable** → Python ou JavaScript, les deux t'ouvrent tout

**Mon conseil honnête** : le premier langage compte moins que la régularité. Choisis selon UN projet précis qui te motive (pas selon un classement). Si tu hésites encore : **Luau** vu ton intérêt pour Roblox — et je peux t'écrire des scripts d'exercice adaptés !`,
  },
  {
    keywords: ['conseil dev', 'progresser', 'meilleures pratiques', 'bon code', 'bien coder'],
    question: 'Conseils pour progresser en dev',
    answer: `**Comment progresser vraiment en programmation :**

1. **Code, ne regarde pas** : 1 h de pratique vaut 10 h de tutos. Le piège du "tutorial hell" est réel — fais, casse, répare.
2. **Lis les erreurs en entier** : 90 % des débutants paniquent devant le message rouge. La réponse y est (fichier + ligne + raison).
3. **Nomme bien tes variables** : \`pieceSpawnTimer\` > \`x2\`. Ton code doit se lire comme une phrase.
4. **Petit et fréquent** : un commit par fonctionnalité, une chose qui marche à chaque session.
5. **Débogue avec print()** : affiche tes variables à chaque étape, tu verras exactement où ça part en vrille.
6. **Recrée des classiques** : Pong, Snake, un obby — tu rencontreras TOUS les problèmes fondamentaux en version miniature.
7. **Explique ton code** à voix haute (technique du canard en caoutchouc) — 50 % des bugs disparaissent à l'oral.

Tu veux que je te génère un exercice adapté ? Dis-moi ton niveau et je te prépare ça.`,
  },
  // ── Architecture Web Moderne, TypeScript, React, Next.js ───────────────────
  {
    keywords: ['typescript', 'typage', 'interface', 'type', 'generics', 'ts'],
    question: 'Pourquoi et comment bien utiliser TypeScript ?',
    answer: `**TypeScript — écrire du code robuste et auto-documenté :**

1. **Pourquoi TypeScript ?** Il ajoute un système de types statiques par-dessus JavaScript. Les bugs (propriété \`undefined\`, mauvais argument, contrat d'API cassé) sont détectés **à la compilation** au lieu de planter en production.
2. **Règles d'architecture essentielles** :
   - **Bannir \`any\`** : préfère \`unknown\` accompagné d'un *type guard* (ou d'un schéma **Zod**) pour valider les entrées externes (JSON d'API, formulaires).
   - **Unions discriminées** (idéal pour les événements SSE ou les états UI) :
\`\`\`ts
type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }
\`\`\`
   - **Génériques (\`<T>\`)** : réutilise ta logique tout en conservant l'inférence exacte du type de retour.
   - **\`strict: true\`** dans \`tsconfig.json\` : active \`strictNullChecks\` pour éliminer les erreurs \`Cannot read properties of undefined\`.`,
  },
  {
    keywords: ['react', 'nextjs', 'server component', 'hooks', 'useeffect', 'usestate', 'zustand'],
    question: 'Architecture React 19 & Next.js App Router',
    answer: `**React 19 & Next.js (App Router) — bonnes pratiques d'architecture :**

1. **Server Components (RSC) par défaut** : dans \`app/\`, les composants s'exécutent côté serveur (accès direct à la base de données, zéro JS envoyé au client pour le rendu statique).
2. **Client Components (\`'use client'\`)** : ajoute cette directive uniquement aux feuilles de l'arbre qui ont besoin d'interactivité (\`useState\`, événements DOM, WebGL/Three.js, \`localStorage\`).
3. **Gestion d'état** :
   - **État local** : \`useState\` / \`useReducer\`
   - **État global partagé** : **Zustand** (léger, sélecteurs granulaires sans re-renders inutiles)
   - **Données serveur** : React Query / SWR ou Server Actions
4. **Piège classique avec \`useEffect\`** : ne l'utilise jamais pour calculer un état dérivé (utilise \`useMemo\` ou calcule-le directement pendant le rendu). Réserve \`useEffect\` à la synchronisation avec un système externe (WebSocket, timer, DOM).`,
  },
  {
    keywords: ['securite', 'owasp', 'xss', 'csrf', 'ssrf', 'injection sql', 'chiffrement', 'aes'],
    question: 'Sécurité applicative Web (OWASP & Chiffrement)',
    answer: `**Les piliers de la sécurité Web moderne (OWASP) :**

1. **Injections (SQL, Commandes, IMAP)** :
   - **Toujours** utiliser des requêtes préparées (\`?\` avec paramètres liés) — jamais de concaténation de chaînes.
2. **SSRF (Server-Side Request Forgery)** :
   - Quand un serveur récupère une URL fournie par l'utilisateur, il faut **bloquer** les IP privées (\`127.0.0.0/8\`, \`10.0.0.0/8\`, \`172.16.0.0/12\`, \`192.168.0.0/16\`, \`169.254.169.254\`, \`::1\`) et vérifier la résolution DNS avant la requête.
3. **XSS (Cross-Site Scripting)** :
   - Échapper toute sortie HTML, bannir \`dangerouslySetInnerHTML\` sur du contenu non assaini, et définir une **Content-Security-Policy (CSP)**.
4. **Stockage des secrets (AES-256-GCM)** :
   - Mots de passe utilisateur → hachage lent salé (**Argon2id** ou **bcrypt**).
   - Tokens d'API tiers réversibles → chiffrement authentifié **AES-256-GCM** avec vecteur d'initialisation (IV) aléatoire de 12 octets et clé maîtresse hors dépôt Git.`,
  },
  {
    keywords: ['transformer', 'llm', 'attention', 'claude', 'gpt', 'rag', 'comment marche une ia'],
    question: 'Comment fonctionnent les grands modèles de langage (Claude, GPT, Transformers) ?',
    answer: `**Architecture des LLMs modernes (Transformers, Claude, GPT) :**

1. **Tokenisation (BPE)** : le texte est découpé en sous-mots (*tokens*, ~3-4 caractères en moyenne) convertis en vecteurs numériques (*embeddings*).
2. **Self-Attention (Auto-Attention)** : chaque token calcule un score d'affinité ($Q \\cdot K^T / \\sqrt{d_k}$) avec tous les tokens précédents du contexte. C'est ce qui permet au modèle de relier un pronom ou une variable déclarée 2 000 lignes plus haut à son utilisation actuelle.
3. **Pré-entraînement vs Alignement** :
   - **Pré-entraînement** : prédiction du token suivant sur des milliers de milliards de mots (code, sciences, littérature).
   - **Post-entraînement (RLHF / Constitutional AI chez Anthropic Claude)** : affinage sur des instructions, du raisonnement étape par étape (*Chain-of-Thought*) et des principes de sécurité/honnêteté.
4. **RAG (Retrieval-Augmented Generation) & Tool Use** :
   - Plutôt que de tout réciter de mémoire (risque d'hallucination), l'agent interroge une base de connaissances, exécute des outils (recherche web, lecture de code, base SQLite) et **ancre sa réponse sur les faits vérifiés**.`,
  },
  {
    keywords: ['threejs', 'webgl', 'shader', 'glsl', '3d', 'quaternion', 'matrice', 'pbr'],
    question: 'Three.js, WebGL et rendu 3D temps réel',
    answer: `**Rendu 3D temps réel avec Three.js & WebGL :**

1. **Graphe de scène (\`Scene\`)** : hiérarchie d'objets (\`Object3D\`, \`Group\`, \`Mesh\`). Chaque \`Mesh\` combine une **Géométrie** (sommets, normales, UV) et un **Matériau** (shaders).
2. **Matériaux PBR (\`MeshStandardMaterial\` / \`MeshPhysicalMaterial\`)** :
   - Basés sur la physique de la lumière : \`roughness\` (0 = miroir, 1 = mat) et \`metalness\` (0 = diélectrique, 1 = métal conducteur).
3. **Optimisation des performances (60+ FPS)** :
   - **Draw calls** : regroupe les objets identiques (arbres, particules, étincelles) dans un **\`InstancedMesh\`** (1 seul appel GPU pour 1 000 objets).
   - **Mémoire GPU** : appelle toujours \`geometry.dispose()\` et \`material.dispose()\` quand un objet est détruit.
   - **Mathématiques** : évite \`new THREE.Vector3()\` dans la boucle \`useFrame\` (réutilise une instance en \`useRef\`), et préfère les **Quaternions** (\`slerp\`) aux angles d'Euler pour éviter le *Gimbal Lock*.`,
  },
  {
    keywords: ['roblox', 'anti cheat', 'securite roblox', 'optimisation roblox', 'cframe', 'raycast'],
    question: 'Architecture Roblox avancée : CFrame, Raycast, Anti-Cheat et Optimisation',
    answer: `**Roblox Studio / Luau avancé — niveau production :**

1. **CFrame (Coordinate Frame)** : combine position 3D + matrice de rotation 3×3.
   - Regarder vers une cible : \`CFrame.lookAt(origine, cible)\`
   - Avancer de 5 studs dans la direction du regard : \`part.CFrame = part.CFrame * CFrame.new(0, 0, -5)\`
2. **Raycast moderne (\` workspace:Raycast \`)** :
\`\`\`lua
local params = RaycastParams.new()
params.FilterType = Enum.RaycastFilterType.Exclude
params.FilterDescendantsInstances = { character }

local result = workspace:Raycast(origine, direction * 100, params)
if result then
    print("Touché :", result.Instance.Name, "à", result.Position)
end
\`\`\`
3. **Sécurité Anti-Exploit (Server Authority)** :
   - Un exploiteur peut modifier son \`LocalScript\`, téléporter son \`HumanoidRootPart\` et envoyer n'importe quel argument à un \`RemoteEvent\`.
   - **Côté serveur** : valide les types (\`typeof(x) == "Vector3"\`), vérifie les distances (\`(hrp.Position - cible.Position).Magnitude <= 15\`), impose un *rate-limit* par joueur (\`os.clock()\`) et garde l'argent/inventaire exclusivement dans \`ServerStorage\` / \`DataStoreService\`.`,
  },
]

// ── NEXUS : questions sur lui-même (utilisées par l'intention identity) ───────

export const NEXUS_PRESENTATION = `**Moi, c'est NEXUS** — un agent IA **hybride** : un moteur de raisonnement LLM quand il est disponible, et un ensemble de **compétences locales** (écrites from scratch) qui prennent le relais instantanément dès que le moteur distant est limité. Résultat : je réponds **vite et intelligemment**, sans jamais te laisser bloqué par une erreur 429.

**Sous le capot** :
- 🧠 Un **moteur de raisonnement** LLM avec disjoncteur automatique + un **classifieur neuronal local** (perceptron multicouche entraîné ici) pour les réponses instantanées
- 🔎 Un moteur de **recherche web multi-sources en parallèle** (Google Actualités ∥ Bing ∥ DuckDuckGo) + lecteur de pages avec **synthèse extractive** et captures d'écran réelles
- 🤖 Un **runner de missions autonomes** : tu me confies des missions, je les exécute en arrière-plan — je cherche sur Google, YouTube, TikTok et les sources IA, j'en extrais des **compétences** que je range dans ma base de connaissances, puis je rédige un **rapport**
- ✍️ Un **générateur de code** (Roblox/Luau, Python, JS…) branché au Studio Code
- 🎨 Un **générateur d'images procédural** et un **constructeur de scènes 3D**
- 🗄️ Une **mémoire longue terme** et une **base de connaissances** persistantes (SQLite)

Chaque mission que tu me donnes me rend **plus compétent** : ce que j'apprends est réinjecté dans mes réponses suivantes. Tu peux me questionner sur mon raisonnement à tout moment !`

/** Recherche dans la banque intégrée : retourne les meilleures entrées + score. */
export function searchKnowledgeBank(query: string, max = 3): { entry: KnowledgeEntry; score: number }[] {
  const qStems = new Set(stems(query))
  if (qStems.size === 0) return []
  const scored = NEXUS_KNOWLEDGE.map((entry) => {
    let score = 0
    for (const kw of entry.keywords) {
      const kwStems = new Set(stems(kw))
      let matched = 0
      for (const s of kwStems) if (qStems.has(s)) matched++
      if (matched > 0) {
        const exact = kwStems.size > 0 && [...kwStems].every((s) => qStems.has(s))
        const kwScore =
          matched / kwStems.size +
          (exact && kw.includes(' ') ? 0.5 : 0) +
          kw.length * 0.012 +
          (exact ? 0.35 : 0)
        score = Math.max(score, kwScore)
      }
    }
    // Bonus de similarité sémantique neuronale (capte les reformulations et sous-mots)
    const sem = semanticSimilarity(query, `${entry.question} ${entry.keywords.join(' ')}`)
    if (sem > 0.35) {
      score = Math.max(score, sem * 1.15)
    }
    return { entry, score }
  })
    .filter((r) => r.score > 0.38)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
  return scored
}
