// ─── NEXUS Brain — Dataset d'entraînement des intentions (FR + EN) ────────────
// Exemples écrits à la main + expansion programmatique (gabarits × sujets).
// Le réseau est entraîné au démarrage sur ces données — aucune API.

import type { TrainSample } from './neural'

export const INTENTS = [
  'greeting', // bonjour, salut, hello, coucou
  'farewell', // au revoir, bye, à plus
  'thanks', // merci, thanks
  'howareyou', // ça va ? comment vas-tu ?
  'identity', // qui es-tu ? c'est quoi NEXUS ?
  'capabilities', // que sais-tu faire ? aide
  'search', // cherche, recherche, actualités, prix, météo
  'readpage', // lis cette page, ouvre cette URL
  'code', // script, programme, code, mod Roblox…
  'image', // génère une image, dessine, logo
  'scene3d', // scène 3D, modélise, monde 3D
  'webpage', // page web, site, landing, mini-jeu navigateur
  'video', // vidéo, clip, film, animation filmée
  'math', // calculs, expressions arithmétiques
  'task', // missions, avancement, bouton Task
  'knowledge_save', // retiens, note ça, enregistre
  'knowledge_query', // que sais-tu sur…, mes notes
  'time', // heure, date, jour
  'about_user', // qui je suis, mon nom, ce que tu sais sur moi
  'smalltalk', // questions générales, discussion
] as const

export type IntentLabel = (typeof INTENTS)[number]

// ── Exemples manuels (la base fiable de chaque intention) ─────────────────────

const HANDWRITTEN: Record<IntentLabel, string[]> = {
  greeting: [
    'bonjour', 'salut', 'hello', 'coucou', 'hey', 'yo', 'bonsoir', 'wesh',
    'salut nexus', 'bonjour nexus', 'hello world', 'hi', 'hey nexus', 'top',
    'bonjour comment ca va', 'salut ca boume', 'good morning', 'coucou toi',
    'hello la team', 'salut mon pote', 'bjr', 'slt', 'yo yo', 'hello there',
  ],
  farewell: [
    'au revoir', 'bye', 'a plus', 'a plus tard', 'salut a plus', 'bonne nuit',
    'ciao', 'adieu', 'je pars', 'bonne journee', 'a demain', 'bye bye',
    'goodbye', 'see you', 'a bientot', 'je m en vais', 'bonne soiree', 'peace',
  ],
  thanks: [
    'merci', 'merci beaucoup', 'merci nexus', 'thanks', 'thank you',
    'merci bien', 'c est parfait merci', 'super merci', 'nickel merci',
    'merci pour ton aide', 'merci bcp', 'thx', 'merci encore', 'genial merci',
    'parfait merci beaucoup', 'merci c est genial', 'merci tu geres',
  ],
  howareyou: [
    'ca va', 'comment vas tu', 'comment ca va', 'tu vas bien',
    'comment tu te sens', 'la forme', 'ca boume', 'quoi de neuf',
    'how are you', 'comment se passe ta journee', 'tu es en forme',
    'ca va nexus', 'tu va bien', 'comment vas-tu aujourd hui',
  ],
  identity: [
    'qui es tu', 'tu es qui', 'c est quoi nexus', 'tu es quoi exactement',
    'presente toi', 'parle moi de toi', 'tu es un robot', 'tu es une ia',
    'comment tu t appelle', 'quel est ton nom', 'tu es reel',
    'who are you', 'what are you', 'tu es un vrai intelligence',
    'tu exists vraiment', 'explique moi ce que tu es', 'ton nom c est quoi',
    'tu es humain', 'es tu conscient', 'tu sers a quoi nexus',
    'decris toi', 'decris toi en detail', 'decris toi stp', 'decris-toi',
    'decrire toi', 'decrit toi', 'presente toi en detail', 'presente toi stp',
    'raconte toi', 'raconte moi toi', 'parle de toi', 'dis moi qui tu es',
    'dis moi tout sur toi', 'fais ta presentation', 'fais moi ta presentation',
    'donne moi ta presentation', 'definis toi', 'qui es tu vraiment',
    'c est quoi ton histoire', 'ton histoire c est quoi', 'tu es quoi',
    't es qui exactement', 'presente toi a moi', 'describe yourself',
    'introduce yourself', 'decris ce que tu es', 'presente toi nexus',
  ],
  capabilities: [
    'que sais tu faire', 'tu sais faire quoi', 'quelles sont tes fonctions',
    'aide', 'help', 'liste de tes outils', 'comment tu marches',
    'presente tes fonctionnalites', 'tu as quels outils', 'help me',
    'que peux tu faire pour moi', 'montre moi ce que tu sais faire',
    'tes capacites', 'quels sont tes talents', 'donne moi un coup de main',
    'comment ca marche ici', 'les commandes disponibles', 'tu fais quoi comme trucs',
    'j ai besoin d aide', 'liste tout ce que tu peux faire', 'tes outils',
    'c est quoi les studios', 'tu as un editeur de code', 'tu peux faire de la 3d',
  ],
  search: [
    'cherche le prix du bitcoin', 'recherche les dernieres news gaming',
    'trouve moi la meteo de paris', 'quel temps fait il a lyon',
    'actualites du jour', 'donne moi les news tech', 'prix de ethereum',
    'cherche sur internet les nouveaux jeux roblox', 'score du match',
    'qui a gagne le match hier', 'cherche les horaires du cine',
    'recherche les meilleures tablettes 2026', 'quoi de neuf en ia',
    'cherche la definition de machine learning', 'dernieres actus espace',
    'trouve un tuto blender', 'cherches moi le meilleur prix iphone',
    'resultats elections', 'cours de la bourse aujourd hui', 'meteo demain',
    'cherche du.cv', 'infos sur la coupe du monde', 'trouve la chanson tendance',
  ],
  readpage: [
    'lis cette page https://example.com', 'ouvre example.com',
    'resume moi cette url https://wikipedia.org', 'vis ce site https://roblox.com',
    'va lire https://github.com', 'regarde cette page https://news.ycombinator.com',
    'lectures de https://mdn.dev', 'que dit cette page https://lemonde.fr',
    'analyse cette page web https://openai.com', 'https://threejs.org resume la',
    'va sur cette adresse et dis moi ce qu il y a https://reddit.com',
  ],
  code: [
    'ecris un script lua qui spawn des pieces', 'fais moi un mod roblox',
    'code moi un script python qui trie une liste', 'programme un bot discord',
    'ecrires un programme en c qui lit un fichier', 'un script luau pour roblox studio',
    'developpe un algorithme de tri rapide', 'donne moi une fonction javascript',
    'code un generateur de mot de passe', 'script de leaderboard roblox',
    'creer un systeme de sauvegarde datastore roblox', 'ecris du code',
    'je veux un script', 'programme une calculatrice en python',
    'fais un script de kill brick', 'lua script pour porte automatique',
    'ecris un shader glsl', 'requete sql pour joindre deux tables',
    'automatise un fichier en bash', 'un bot discord en python',
    'code le jeu du pendu', 'generer du code csharp unity',
    'ecrire une classe java', 'fonction rust qui calcule fibonacci',
  ],
  image: [
    'genere une image de renard', 'dessine moi un chat kawaii',
    'une image de coucher de soleil', 'cree un logo pour ma chaine',
    'fais moi un visuel de ville futuriste', 'genere un poster de film',
    'illustration d un dragon', 'dessine un paysage de montagne',
    'image mignonne de panda', 'logo gaming neon', 'une image de robot',
    'dessine un personnage de jeu video', 'genere un fond d ecran space',
    'visuel d une foret magique', 'portrait de chevalier en armure',
    'photo de voiture de sport stylisee', 'dessin anime de licorne',
    'une image pour mon discord', 'genere un avatar pixel art',
  ],
  scene3d: [
    'cree une scene 3d d une ville', 'modelise une maison en 3d',
    'construis une ile flottante', 'une scene 3d avec des arbres',
    'fait moi un monde 3d de chateau', 'scene 3d baseplate roblox',
    'genere une demo 3d de fusee', 'modelise une voiture en 3d',
    'cree une scene avec des montagnes', 'monde 3d de ville neon',
    'scene 3d d un quartier avec des maisons', 'construis un parc d attractions 3d',
    'une maquette 3d d un stadium', 'scene 3d du systeme solaire',
    'fais une scene 3d de foret', 'modelise un vaisseau spatial',
  ],
  webpage: [
    'cree une page web de presentation', 'fais moi un site de portfolio',
    'genere une landing page pour un cafe', 'une page web avec un formulaire de contact',
    'cree un mini jeu en html', 'site web pour mon serveur roblox',
    'genere une page todo liste', 'fais un site vitrine pour mon entreprise',
    'page web d un jeu de quiz', 'cree un site de blog', 'landing page moderne',
    'une page web avec des animations', 'site de presentation de mon jeu',
    'cree une page portfolio de photographe', 'page web horloge pomodoro',
    'fais moi un generateur de citations en html', 'site pour vendre des gamepass',
  ],
  video: [
    'genere une video de ville cyberpunk', 'fais moi un clip anime',
    'cree une video de drone au dessus de montagnes', 'un film de 5 secondes avec un dragon',
    'genere une video cinématique', 'video d un vaisseau dans l espace',
    'fais une petite video de vague', 'clip video de voiture qui roule',
    'video publicitaire pour mon jeu', 'anime une scene en video',
    'genere une video de feu d artifice', 'cree un trailer pour mon jeu roblox',
  ],
  math: [
    'combien font 12 plus 45', 'calcule 8 fois 7', 'combien fait 150/4',
    'racine carree de 144', 'combien font 2 puissance 10', 'calcule 15% de 240',
    '34 plus 56 fois 2', 'resous 9 fois 9 plus 10', 'log de 100',
    'combien fait le pgcd de 12 et 18', 'converti 30 pourcent de 80',
    'calcule la moyenne de 12 15 et 9', 'sin de pi sur 2', '5 au carre',
    '100 divise par 8', 'prix 20 euros moins 15 pourcent', '2+2',
    '3*7+2', '(12+8)/4', '10^3', 'sqrt(225)', '50-17*2',
  ],
  task: [
    'cree une mission veille roblox', 'assigne une tache de nettoyage',
    'nouvelle mission pour toi', 'avancement de la mission',
    'ou en est la mission', 'mets a jour la mission', 'mission terminee',
    'note dans la mission que j ai valide le design', 'les taches a faire',
    'ajoute une mission de test', 'mission bloquee', 'statut de ma tache',
    'je te confie une mission', 'liste mes missions', 'bilan de la mission',
    'ajoute un objectif a la mission', 'mission developpement du jeu',
  ],
  knowledge_save: [
    'retiens que mon jeu s appelle nexus quest', 'note ca dans ta base',
    'enregistre la recette du gateau au chocolat', 'retiens cette information',
    'ajoute a ma base de connaissances la doc roblox', 'souviens toi que je prefere le bleu',
    'enregistre cette note', 'stocke cette info', 'met dans tes notes',
    'retiens mon pseudo c est maxpro', 'note que ma reunion est a 15h',
    'garde en memoire la regle du jeu', 'ajoute cette definition a la base',
    'souviens toi de ca', 'enregistre dans les connaissances',
  ],
  knowledge_query: [
    'que sais tu sur roblox', 'cherche dans ma base de connaissances',
    'mes notes sur python', 'que retiens tu sur mon projet',
    'cherche dans tes notes la recette', 'tu te souviens de la doc',
    'que as tu en memoire sur le jeu', 'recherche dans la base le mot datastore',
    'mes connaissances sur lua', 'retrouve la note sur blender',
    'c est quoi que tu as note sur mon planning', 'va chercher dans ta base',
    'les notes de la categorie programmation',
  ],
  time: [
    'quelle heure est il', 'quel jour sommes nous', 'date du jour',
    'on est quel jour', 'donne moi l heure', 'il est quelle heure',
    'quelle est la date d aujourd hui', 'time please', 'le jour et l heure',
    'c est quand exactement', 'date et heure actuelles',
  ],
  about_user: [
    'comment je m appelle', 'qui je suis', 'tu connais mon nom',
    'tu te souviens de moi', 'ce que tu sais sur moi', 'mon prenom',
    'dis moi qui je suis', 'tu sais qui je suis', 'mes informations',
    'quelles infos tu as sur moi', 'presente moi', 'tu te rappelles de mes projets',
    'mon nom c est quoi deja', 'souviens toi de mon profil',
  ],
  smalltalk: [
    'pourquoi le ciel est bleu', 'explique moi la gravite',
    'raconte moi une blague', 'donne moi une idee de jeu video',
    'quel est ton jeu prefere', 'conseils pour progresser en programmation',
    'c est quoi la photosynthese', 'explique la theorie de la relativite',
    'raconte une histoire courte', 'comment apprendre le lua vite',
    'quel langage apprendre en premier', 'donne moi des idees de projets',
    'astuces pour roblox studio', 'comment faire un jeu qui cartonne',
    'motivation pour coder', 'c est quoi un black hole', 'explique l ia simplement',
    'fais moi rire', 'je suis fatigue', 'je suis demotive',
    'comment organiser mon temps', 'c est quoi le big bang',
    'pourquoi la mer est salee', 'comment fonctionne internet',
    'c est quoi un algorithme', 'donne moi un conseil de dev',
    'meilleures pratiques de code', 'c est quoi git', 'explique moi les boucles',
  ],
}

// ── Expansion programmatique : gabarits × sujets ──────────────────────────────

const TOPICS = [
  'roblox', 'python', 'minecraft', 'le football', 'la cuisine italienne',
  'les dinosaures', 'la nasa', 'tokyo', 'l empire romain', 'la guitare',
  'les voitures electriques', 'mario', 'les chats', 'leonard de vinci',
  'la peinture', 'java', 'les maths', 'la physique quantique', 'napoleon',
  'les requins', 'l egypte antique', 'unity', 'blender', 'le japon',
  'les volcans', 'l esquimau', 'beethoven', 'les abeilles', 'internet',
]

function expand(): string[] {
  const out: string[] = []
  const push = (s: string) => {
    if (s.length > 2 && s.length < 90) out.push(s)
  }

  // search
  for (const t of TOPICS) {
    push(`cherche des infos sur ${t}`)
    push(`recherche ${t}`)
    push(`trouve moi des infos sur ${t}`)
    push(`actualites ${t}`)
    push(`donne moi des news sur ${t}`)
    push(`quel est le prix de ${t}`)
    push(`infos recentes sur ${t}`)
  }
  for (const city of ['paris', 'marseille', 'new york', 'londres', 'tokyo']) {
    push(`meteo a ${city}`)
    push(`meteo ${city} demain`)
    push(`temps a ${city}`)
  }
  for (const q of ['bitcoin', 'ethereum', 'or', 'petrole']) {
    push(`prix du ${q}`)
    push(`cours du ${q}`)
    push(`cherche le cours de ${q}`)
  }
  for (const s of ['psg', 'real madrid', 'om', 'lakers']) {
    push(`score de ${s}`)
    push(`resultat du match de ${s}`)
  }

  // code
  const codeLangs = ['python', 'javascript', 'lua', 'csharp', 'java', 'rust', 'go', 'c', 'cpp', 'typescript']
  for (const l of codeLangs) {
    push(`un script ${l}`)
    push(`ecris du code en ${l}`)
    push(`programme en ${l}`)
    push(`fais moi un script ${l}`)
    push(`code en ${l} pour trier des donnees`)
  }
  for (const k of ['sauter plus haut', 'un systeme de pieces', 'un magasin', 'des zombies', 'un checkpoint', 'un inventaire', 'des degats de zone']) {
    push(`script roblox pour ${k}`)
    push(`fais moi un mod roblox avec ${k}`)
    push(`code luau pour ${k}`)
    push(`comment coder ${k} en roblox`)
  }

  // image
  for (const subj of ['un loup dans la neige', 'une ville cyberpunk', 'un chateau medieval', 'un dragon de feu', 'une plage tropicale', 'un astronaute sur mars', 'un samourai', 'un panda qui fait du velo']) {
    push(`genere une image de ${subj}`)
    push(`dessine ${subj}`)
    push(`fais moi une image de ${subj}`)
    push(`cree un visuel de ${subj}`)
    push(`une illustration de ${subj}`)
  }
  for (const brand of ['ma chaine gaming', 'mon serveur roblox', 'mon studio de jeu', 'mon entreprise de pizzas']) {
    push(`cree un logo pour ${brand}`)
    push(`genere un logo pour ${brand}`)
    push(`fais un logo pour ${brand}`)
  }

  // scene3d
  for (const sc of ['une ville futuriste', 'un village medieval', 'une station spatiale', 'une plage avec des palmiers', 'un terrain de basket', 'un circuit de course', 'un donjon sombre', 'un jardin japonais']) {
    push(`cree une scene 3d de ${sc}`)
    push(`modelise ${sc}`)
    push(`construis ${sc} en 3d`)
    push(`genere un monde 3d avec ${sc}`)
  }

  // webpage
  for (const wp of ['un restaurant', 'un salon de coiffure', 'une salle de sport', 'mon jeu video', 'une agence de voyage', 'un club de robotique']) {
    push(`cree un site web pour ${wp}`)
    push(`genere une page web pour ${wp}`)
    push(`fais moi un site pour ${wp}`)
    push(`une landing page pour ${wp}`)
  }
  push('cree un jeu de memory en html')
  push('fais un pendu en html')
  push('genere une page calculatrice')

  // video
  for (const vid of ['un lever de soleil sur la mer', 'un vaisseau spatial qui vole', 'une ville la nuit sous la pluie', 'un panda qui mange du bambou', 'des montagnes enneiges vues par drone']) {
    push(`genere une video de ${vid}`)
    push(`fais moi un clip de ${vid}`)
    push(`cree une video avec ${vid}`)
  }

  // math
  const nums: [number, number][] = [[12, 8], [45, 33], [128, 256], [9, 7], [144, 12], [500, 230], [75, 25], [2026, 1998]]
  for (const [a, b] of nums) {
    push(`combien font ${a} plus ${b}`)
    push(`calcule ${a} fois ${b}`)
    push(`${a} moins ${b}`)
    push(`${a} divise par ${b === 0 ? 1 : b}`)
    push(`combien fait ${a} + ${b}`)
    push(`calcule ${a} * ${b}`)
  }

  // knowledge_save
  for (const fact of ['mon anniversaire est le 12 mai', 'mon jeu s appelle galaxy tycoon', 'je code en luau tous les jours', 'ma couleur preferee est le vert', 'mon serveur discord a 500 membres']) {
    push(`retiens que ${fact}`)
    push(`note ca : ${fact}`)
    push(`enregistre que ${fact}`)
    push(`souviens toi que ${fact}`)
  }

  // knowledge_query
  for (const kq of ['roblox', 'python', 'mon jeu', 'la recette', 'le datastore', 'blender', 'mon planning']) {
    push(`que sais tu sur ${kq}`)
    push(`cherche dans ta base ${kq}`)
    push(`mes notes sur ${kq}`)
    push(`que as tu retenu sur ${kq}`)
  }

  // task
  for (const m of ['organiser le serveur discord', 'creer la map du jeu', 'corriger les bugs du menu', 'preparer la video de lancement']) {
    push(`cree une mission ${m}`)
    push(`je te confie la mission ${m}`)
    push(`nouvelle mission : ${m}`)
    push(`avancement de la mission ${m}`)
  }

  // smalltalk
  for (const st of ['la gravite', 'les trous noirs', 'la photosynthese', 'internet', 'le big bang', 'les volcans', 'la memoire', 'le sommeil', 'l intelligence artificielle']) {
    push(`explique moi ${st}`)
    push(`c est quoi ${st}`)
    push(`comment ca marche ${st}`)
    push(`pourquoi ${st} existe`)
  }
  for (const idea of ['un jeu roblox', 'un projet python', 'ma chaine youtube', 'un site web']) {
    push(`donne moi des idees pour ${idea}`)
    push(`des conseils pour ${idea}`)
    push(`comment reussir ${idea}`)
  }

  return out
}

/** Construit le dataset complet {texte, label}. */
export function buildDataset(): TrainSample[] {
  const samples: TrainSample[] = []
  INTENTS.forEach((label, idx) => {
    const examples = HANDWRITTEN[label as IntentLabel] ?? []
    for (const text of examples) samples.push({ text, label: idx })
  })
  // Les exemples générés sont répartis selon des gabarits par intention :
  const generated = expand()
  const generatedByIntent: Record<string, string[]> = {
    search: [], code: [], image: [], scene3d: [], webpage: [], video: [],
    math: [], knowledge_save: [], knowledge_query: [], task: [], smalltalk: [],
  }
  // Attribution par mots-clés de gabarits (les gabarits commencent par des verbes précis)
  const rules: [RegExp, string][] = [
    [/^(cherche|recherche|trouve|actualites|donne moi des news|quel est le prix|infos recentes|meteo|temps a|prix du|cours du|score|resultat)/, 'search'],
    [/^(un script|ecris du code|programme|fais moi un script|code en|script roblox|fais moi un mod|code luau|comment coder)/, 'code'],
    [/^(genere une image|dessine|fais moi une image|cree un visuel|une illustration|cree un logo|genere un logo|fais un logo)/, 'image'],
    [/^(cree une scene 3d|modelise|construis|genere un monde 3d)/, 'scene3d'],
    [/^(cree un site web|genere une page web|fais moi un site|une landing page|cree un jeu de memory|fais un pendu|genere une page calculatrice)/, 'webpage'],
    [/^(genere une video|fais moi un clip|cree une video)/, 'video'],
    [/^(combien font|calcule|moins|divise par|combien fait)/, 'math'],
    [/^(retiens que|note ca|enregistre que|souviens toi que)/, 'knowledge_save'],
    [/^(que sais tu sur|cherche dans ta base|mes notes sur|que as tu retenu sur)/, 'knowledge_query'],
    [/^(cree une mission|je te confie la mission|nouvelle mission|avancement de la mission)/, 'task'],
    [/^(explique moi|c est quoi|comment ca marche|pourquoi|donne moi des idees|des conseils|comment reussir)/, 'smalltalk'],
  ]
  for (const text of generated) {
    for (const [re, intent] of rules) {
      if (re.test(text)) {
        generatedByIntent[intent]?.push(text)
        break
      }
    }
  }
  for (const [intent, texts] of Object.entries(generatedByIntent)) {
    const idx = INTENTS.indexOf(intent as IntentLabel)
    if (idx === -1) continue
    for (const text of texts) samples.push({ text, label: idx })
  }
  return samples
}
