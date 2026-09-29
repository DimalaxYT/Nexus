// ─── NEXUS Brain — Générateur de pages web from scratch ──────────────────────
// Templates HTML/CSS/JS complets et responsives : landing, todo, pomodoro,
// quiz, portfolio. Tout est statique, autonome, prêt pour le Studio Code.

export interface GeneratedWebpage {
  html: string
  css: string
  js: string
  description: string
}

interface PageCtx {
  text: string
  topic: string
}

const ACCENTS: [RegExp, string][] = [
  [/\b(neon|cyberpunk|futuriste|gaming|tech)\b/i, '#a855f7'],
  [/\b(cafe|coffee|chocolat|brun|marron)\b/i, '#c2703d'],
  [/\b(nature|foret|vert|jardin|ecologie)\b/i, '#22a06b'],
  [/\b(mer|ocean|eau|bleu|aqua)\b/i, '#0ea5a5'],
  [/\b(rose|bonbon|candy|kawaii|mignon)\b/i, '#ec4899'],
  [/\b(jaune|soleil|agrumes|energie)\b/i, '#d9a521'],
  [/\b(resto|restaurant|pizza|food|cuisine)\b/i, '#e05d3d'],
]

function accentFor(text: string): string {
  for (const [re, color] of ACCENTS) if (re.test(text)) return color
  return '#8b5cf6'
}

const BASE_CSS = (accent: string, dark: boolean): string => `
* { margin: 0; padding: 0; box-sizing: border-box; }
:root {
  --accent: ${accent};
  --accent-soft: ${accent}22;
  --bg: ${dark ? '#0c0a14' : '#fafafa'};
  --surface: ${dark ? '#17141f' : '#ffffff'};
  --text: ${dark ? '#f1f0f5' : '#1c1a24'};
  --muted: ${dark ? '#9d99ab' : '#6b6880'};
  --border: ${dark ? '#2a2637' : '#e8e6ef'};
  --radius: 14px;
}
body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }
.container { max-width: 960px; margin: 0 auto; padding: 0 20px; }
h1, h2, h3 { line-height: 1.25; letter-spacing: -0.02em; }
.btn {
  display: inline-block; padding: 12px 26px; border: none; border-radius: 999px;
  background: var(--accent); color: white; font-size: 1rem; font-weight: 600;
  cursor: pointer; transition: transform .15s ease, box-shadow .15s ease;
}
.btn:hover { transform: translateY(-2px); box-shadow: 0 8px 24px ${accent}55; }
.btn:active { transform: translateY(0); }
.carte {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 22px; transition: transform .18s ease, box-shadow .18s ease;
}
.carte:hover { transform: translateY(-3px); box-shadow: 0 12px 30px rgba(0,0,0,.12); }
@media (max-width: 640px) { .container { padding: 0 14px; } }
`

// ── Landing page ─────────────────────────────────────────────────────────────

function landing(ctx: PageCtx): GeneratedWebpage {
  const accent = accentFor(ctx.text)
  const titre = ctx.topic.split(/[,.]/)[0].slice(0, 48) || 'Mon projet'
  const titreCap = titre.charAt(0).toUpperCase() + titre.slice(1)
  return {
    description: `landing page responsive « ${titreCap} » (accent ${accent})`,
    html: `
<header class="hero">
  <nav class="nav container">
    <span class="logo">◆ ${titreCap}</span>
    <div class="liens">
      <a href="#apropos">À propos</a>
      <a href="#fonctions">Fonctions</a>
      <a href="#contact">Contact</a>
    </div>
  </nav>
  <div class="container hero-content">
    <h1>${titreCap}<br /><span class="surligne">version générée localement</span></h1>
    <p class="sous-titre">Une page moderne, rapide et responsive — construite par le cerveau local de NEXUS, sans aucune dépendance.</p>
    <div class="hero-actions">
      <button class="btn" onclick="document.getElementById('contact').scrollIntoView({behavior:'smooth'})">Commencer</button>
      <button class="btn ghost" id="themeBtn">Toggle thème</button>
    </div>
  </div>
</header>

<section id="fonctions" class="container section">
  <h2>Trois bonnes raisons</h2>
  <div class="grille">
    <article class="carte"><div class="emoji">⚡</div><h3>Instantané</h3><p>Zéro serveur, zéro dépendance : le navigateur fait tout, en un seul fichier.</p></article>
    <article class="carte"><div class="emoji">📱</div><h3>Responsive</h3><p>Grille fluide qui s'adapte du téléphone au grand écran sans effort.</p></article>
    <article class="carte"><div class="emoji">🎨</div><h3>Personnalisable</h3><p>Variables CSS centralisées : change une couleur, tout le site suit.</p></article>
  </div>
</section>

<section id="apropos" class="container section bande">
  <h2>Chiffres clés</h2>
  <div class="stats">
    <div><strong data-cible="98">0</strong><span>% satisfaction</span></div>
    <div><strong data-cible="100">0</strong><span>% local</span></div>
    <div><strong data-cible="24">0</strong><span>/7 disponible</span></div>
  </div>
</section>

<section id="contact" class="container section">
  <h2>Restons en contact</h2>
  <form class="formulaire" id="formContact">
    <input type="text" id="nom" placeholder="Ton nom" required />
    <input type="email" id="email" placeholder="ton@email.com" required />
    <textarea id="message" rows="4" placeholder="Ton message…"></textarea>
    <button class="btn" type="submit">Envoyer ✉️</button>
  </form>
  <p id="confirmation" class="confirmation" hidden>Message bien reçu, merci ! (démo locale — rien n'est envoyé)</p>
</section>

<footer class="footer container">
  <p>© 2026 ${titreCap} — Généré par NEXUS, IA locale · <span id="horloge"></span></p>
</footer>`,
    css: `
${BASE_CSS(accent, true)}
.hero { min-height: 92vh; display: flex; flex-direction: column; background: radial-gradient(1200px 600px at 80% -10%, var(--accent-soft), transparent), var(--bg); }
.nav { display: flex; justify-content: space-between; align-items: center; padding: 18px 20px; }
.logo { font-weight: 800; font-size: 1.15rem; }
.liens { display: flex; gap: 22px; }
.liens a { color: var(--muted); text-decoration: none; font-size: .95rem; transition: color .15s; }
.liens a:hover { color: var(--accent); }
.hero-content { margin: auto 0; padding: 60px 20px; max-width: 760px; }
h1 { font-size: clamp(2.2rem, 6vw, 4rem); font-weight: 800; }
.surligne { color: var(--accent); }
.sous-titre { color: var(--muted); font-size: 1.15rem; margin: 18px 0 28px; max-width: 560px; }
.hero-actions { display: flex; gap: 14px; flex-wrap: wrap; }
.btn.ghost { background: transparent; border: 1.5px solid var(--border); color: var(--text); }
.section { padding: 70px 20px; }
h2 { font-size: clamp(1.6rem, 4vw, 2.4rem); margin-bottom: 34px; }
.grille { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 18px; }
.emoji { font-size: 2rem; margin-bottom: 10px; }
.bande { background: linear-gradient(180deg, transparent, var(--accent-soft), transparent); border-radius: 24px; }
.stats { display: flex; gap: 40px; flex-wrap: wrap; }
.stats strong { display: block; font-size: 2.6rem; color: var(--accent); font-weight: 800; }
.stats span { color: var(--muted); }
.formulaire { display: grid; gap: 12px; max-width: 480px; }
.formulaire input, .formulaire textarea {
  padding: 13px 16px; border-radius: 10px; border: 1.5px solid var(--border);
  background: var(--surface); color: var(--text); font-size: 1rem; resize: vertical;
}
.formulaire input:focus, .formulaire textarea:focus { outline: 2px solid var(--accent); border-color: transparent; }
.confirmation { color: #22c55e; font-weight: 600; margin-top: 10px; }
.footer { text-align: center; color: var(--muted); padding: 30px 20px; font-size: .9rem; }`,
    js: `// Interactions de la page — vanilla JS, aucune dépendance
(function () {
  'use strict';

  // Compteurs animés (IntersectionObserver : ne démarre que si visible)
  var compteurs = document.querySelectorAll('[data-cible]');
  var observateur = new IntersectionObserver(function (entrees) {
    entrees.forEach(function (entree) {
      if (!entree.isIntersecting) return;
      var el = entree.target;
      observateur.unobserve(el);
      var cible = parseInt(el.getAttribute('data-cible'), 10);
      var debut = performance.now();
      (function tic(temps) {
        var p = Math.min(1, (temps - debut) / 1200);
        var eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
        el.textContent = Math.round(cible * eased);
        if (p < 1) requestAnimationFrame(tic);
      })(debut);
    });
  }, { threshold: 0.5 });
  compteurs.forEach(function (el) { observateur.observe(el); });

  // Formulaire : validation + confirmation locale
  var form = document.getElementById('formContact');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var nom = document.getElementById('nom').value.trim();
      var email = document.getElementById('email').value.trim();
      var valide = nom.length > 1 && /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email);
      var confirmation = document.getElementById('confirmation');
      if (valide) {
        confirmation.hidden = false;
        form.reset();
      } else {
        confirmation.hidden = false;
        confirmation.textContent = 'Vérifie ton nom et ton email 🙂';
        confirmation.style.color = '#f59e0b';
      }
    });
  }

  // Horloge du pied de page
  var horloge = document.getElementById('horloge');
  if (horloge) {
    setInterval(function () {
      horloge.textContent = new Date().toLocaleTimeString('fr-FR');
    }, 1000);
  }
})();`,
  }
}

// ── Todo list ────────────────────────────────────────────────────────────────

function todoApp(ctx: PageCtx): GeneratedWebpage {
  return {
    description: 'application Todo-list (ajout, filtres, suppression, persistance localStorage)',
    html: `
<main class="app">
  <h1>✅ Ma liste</h1>
  <form id="form">
    <input id="champ" type="text" placeholder="Nouvelle tâche…" autocomplete="off" />
    <button class="btn" type="submit">Ajouter</button>
  </form>
  <div class="filtres">
    <button data-filtre="toutes" class="actif">Toutes</button>
    <button data-filtre="actives">Actives</button>
    <button data-filtre="terminees">Terminées</button>
  </div>
  <ul id="liste"></ul>
  <p class="compteur" id="compteur"></p>
</main>`,
    css: `
${BASE_CSS(accentFor(ctx.text), true)}
.app { max-width: 540px; margin: 40px auto; padding: 0 16px; }
h1 { margin-bottom: 22px; }
#form { display: flex; gap: 10px; margin-bottom: 16px; }
#champ { flex: 1; padding: 12px 16px; border-radius: 10px; border: 1.5px solid var(--border); background: var(--surface); color: var(--text); font-size: 1rem; }
#champ:focus { outline: 2px solid var(--accent); border-color: transparent; }
.filtres { display: flex; gap: 8px; margin-bottom: 14px; }
.filtres button { padding: 7px 14px; border-radius: 999px; border: 1px solid var(--border); background: transparent; color: var(--muted); cursor: pointer; }
.filtres button.actif { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
#liste { list-style: none; display: grid; gap: 8px; }
#liste li { display: flex; align-items: center; gap: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; animation: pop .18s ease; }
@keyframes pop { from { transform: scale(.97); opacity: 0; } to { transform: scale(1); opacity: 1; } }
#liste li.terminee .texte { text-decoration: line-through; color: var(--muted); }
.case { width: 20px; height: 20px; accent-color: var(--accent); cursor: pointer; }
.texte { flex: 1; }
.suppr { background: none; border: none; color: var(--muted); font-size: 1.1rem; cursor: pointer; }
.suppr:hover { color: #ef4444; }
.compteur { color: var(--muted); text-align: center; margin-top: 14px; font-size: .9rem; }`,
    js: `(function () {
  'use strict';
  var CLE = 'todo-nexus-local';
  var todos = [];
  try { todos = JSON.parse(localStorage.getItem(CLE) || '[]'); } catch (e) { todos = []; }
  var filtre = 'toutes';

  var liste = document.getElementById('liste');
  var compteur = document.getElementById('compteur');

  function sauver() { try { localStorage.setItem(CLE, JSON.stringify(todos)); } catch (e) {} }

  function rendre() {
    liste.innerHTML = '';
    var visibles = todos.filter(function (t) {
      if (filtre === 'actives') return !t.faite;
      if (filtre === 'terminees') return t.faite;
      return true;
    });
    visibles.forEach(function (t) {
      var li = document.createElement('li');
      if (t.faite) li.className = 'terminee';
      var box = document.createElement('input');
      box.type = 'checkbox'; box.className = 'case'; box.checked = t.faite;
      box.addEventListener('change', function () { t.faite = box.checked; sauver(); rendre(); });
      var span = document.createElement('span');
      span.className = 'texte'; span.textContent = t.texte;
      var btn = document.createElement('button');
      btn.className = 'suppr'; btn.textContent = '×'; btn.title = 'Supprimer';
      btn.addEventListener('click', function () {
        todos = todos.filter(function (x) { return x.id !== t.id; });
        sauver(); rendre();
      });
      li.appendChild(box); li.appendChild(span); li.appendChild(btn);
      liste.appendChild(li);
    });
    var restantes = todos.filter(function (t) { return !t.faite; }).length;
    compteur.textContent = todos.length === 0
      ? 'Aucune tâche — ajoute la première !'
      : restantes + ' tâche' + (restantes > 1 ? 's' : '') + ' restante' + (restantes > 1 ? 's' : '') + ' sur ' + todos.length;
  }

  document.getElementById('form').addEventListener('submit', function (e) {
    e.preventDefault();
    var champ = document.getElementById('champ');
    var texte = champ.value.trim();
    if (!texte) return;
    todos.unshift({ id: Date.now(), texte: texte, faite: false });
    champ.value = '';
    sauver(); rendre();
  });

  document.querySelectorAll('.filtres button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.filtres button').forEach(function (x) { x.classList.remove('actif'); });
      b.classList.add('actif');
      filtre = b.getAttribute('data-filtre');
      rendre();
    });
  });

  rendre();
})();`,
  }
}

// ── Pomodoro ─────────────────────────────────────────────────────────────────

function pomodoro(ctx: PageCtx): GeneratedWebpage {
  return {
    description: 'minuteur Pomodoro (25/5 min, cycles, anneau de progression, son local WebAudio)',
    html: `
<main class="pomo">
  <h1>🍅 Pomodoro</h1>
  <p class="mode" id="mode">Focus</p>
  <svg class="anneau" viewBox="0 0 200 200">
    <circle class="fond" cx="100" cy="100" r="90" />
    <circle class="progression" id="anneau" cx="100" cy="100" r="90" />
  </svg>
  <p class="temps" id="temps">25:00</p>
  <div class="controles">
    <button class="btn" id="demarrer">▶ Démarrer</button>
    <button class="btn ghost" id="reinit">↺ Réinitialiser</button>
  </div>
  <p class="cycles">Cycles terminés : <strong id="cycles">0</strong></p>
</main>`,
    css: `
${BASE_CSS('#e05d3d', true)}
.pomo { max-width: 420px; margin: 30px auto; padding: 0 16px; text-align: center; }
.mode { color: var(--muted); letter-spacing: .3em; text-transform: uppercase; font-size: .85rem; margin: 8px 0 4px; }
.anneau { width: 240px; height: 240px; transform: rotate(-90deg); margin: 4px auto; display: block; }
.anneau circle { fill: none; stroke-width: 10; }
.anneau .fond { stroke: var(--border); }
.anneau .progression { stroke: var(--accent); stroke-linecap: round; stroke-dasharray: 565.5; stroke-dashoffset: 0; transition: stroke-dashoffset .5s linear; }
.temps { font-size: 3.4rem; font-weight: 800; margin: -160px 0 120px; font-variant-numeric: tabular-nums; }
.controles { display: flex; gap: 12px; justify-content: center; margin-bottom: 14px; }
.btn.ghost { background: transparent; border: 1.5px solid var(--border); color: var(--text); }
.cycles { color: var(--muted); }`,
    js: `(function () {
  'use strict';
  var DUREES = { focus: 25 * 60, pause: 5 * 60 };
  var mode = 'focus';
  var reste = DUREES.focus;
  var timer = null;
  var cycles = 0;

  var elTemps = document.getElementById('temps');
  var elMode = document.getElementById('mode');
  var anneau = document.getElementById('anneau');
  var CIRCONF = 2 * Math.PI * 90;

  function bip() {
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880; gain.gain.value = 0.08;
      osc.start(); osc.stop(ctx.currentTime + 0.25);
    } catch (e) { /* audio bloqué : silencieux */ }
  }

  function rendre() {
    var m = Math.floor(reste / 60);
    var s = reste % 60;
    elTemps.textContent = m + ':' + (s < 10 ? '0' : '') + s;
    var total = DUREES[mode];
    anneau.style.strokeDashoffset = String(CIRCONF * (1 - reste / total));
    elMode.textContent = mode === 'focus' ? 'Focus' : 'Pause';
  }

  function terminer() {
    bip();
    if (mode === 'focus') {
      cycles++;
      document.getElementById('cycles').textContent = cycles;
      mode = 'pause';
    } else {
      mode = 'focus';
    }
    reste = DUREES[mode];
    arreter();
    rendre();
    demarrer();
  }

  function tick() {
    reste--;
    if (reste <= 0) { terminer(); return; }
    rendre();
  }

  function demarrer() {
    if (timer) return;
    timer = setInterval(tick, 1000);
    document.getElementById('demarrer').textContent = '⏸ Pause';
  }

  function arreter() {
    clearInterval(timer);
    timer = null;
    document.getElementById('demarrer').textContent = '▶ Démarrer';
  }

  document.getElementById('demarrer').addEventListener('click', function () {
    if (timer) arreter(); else demarrer();
  });
  document.getElementById('reinit').addEventListener('click', function () {
    arreter(); mode = 'focus'; reste = DUREES.focus; rendre();
  });

  rendre();
})();`,
  }
}

// ── Quiz ─────────────────────────────────────────────────────────────────────

function quiz(ctx: PageCtx): GeneratedWebpage {
  return {
    description: 'jeu de quiz (questions, score, feedback instantané, rejouable)',
    html: `
<main class="quiz">
  <h1>🧠 Quiz</h1>
  <div class="carte" id="carte">
    <p class="question" id="question"></p>
    <div class="reponses" id="reponses"></div>
  </div>
  <p class="score">Score : <strong id="score">0</strong> / <span id="total">0</span></p>
  <button class="btn" id="rejouer" hidden>↺ Rejouer</button>
</main>`,
    css: `
${BASE_CSS(accentFor(ctx.text), true)}
.quiz { max-width: 560px; margin: 40px auto; padding: 0 16px; text-align: center; }
h1 { margin-bottom: 20px; }
.carte { padding: 28px; }
.question { font-size: 1.3rem; font-weight: 700; margin-bottom: 22px; }
.reponses { display: grid; gap: 10px; }
.reponses button { padding: 13px; border-radius: 10px; border: 1.5px solid var(--border); background: var(--bg); color: var(--text); font-size: 1rem; cursor: pointer; transition: all .15s; }
.reponses button:hover:not(:disabled) { border-color: var(--accent); transform: translateY(-1px); }
.reponses button.bonne { background: #16a34a; border-color: #16a34a; color: white; }
.reponses button.mauvaise { background: #dc2626; border-color: #dc2626; color: white; }
.score { margin: 18px 0; color: var(--muted); }`,
    js: `(function () {
  'use strict';
  var QUESTIONS = [
    { q: "Quel mot-clé Luau déclare une variable locale ?", r: ["local", "var", "let"], bonne: 0 },
    { q: "Combien de côtés a un hexagone ?", r: ["5", "6", "7"], bonne: 1 },
    { q: "Que fait game.Players.PlayerAdded ?", r: ["Se déclenche quand un joueur rejoint", "Crée un joueur", "Supprime un joueur"], bonne: 0 },
    { q: "En Python, quelle structure est immuable ?", r: ["list", "dict", "tuple"], bonne: 2 },
    { q: "Que mesure le FPS ?", r: ["La mémoire", "Les images par seconde", "La taille du fichier"], bonne: 1 }
  ];
  var index = 0, score = 0;

  var elQ = document.getElementById('question');
  var elR = document.getElementById('reponses');
  var elScore = document.getElementById('score');
  var elTotal = document.getElementById('total');
  elTotal.textContent = QUESTIONS.length;

  function poser() {
    var q = QUESTIONS[index];
    elQ.textContent = q.q;
    elR.innerHTML = '';
    q.r.forEach(function (texte, i) {
      var btn = document.createElement('button');
      btn.textContent = texte;
      btn.addEventListener('click', function () {
        var bonne = i === q.bonne;
        if (bonne) { score++; elScore.textContent = score; }
        Array.prototype.forEach.call(elR.children, function (b, j) {
          b.disabled = true;
          if (j === q.bonne) b.className = 'bonne';
          else if (j === i && !bonne) b.className = 'mauvaise';
        });
        setTimeout(function () {
          index++;
          if (index < QUESTIONS.length) poser();
          else finir();
        }, 900);
      });
      elR.appendChild(btn);
    });
  }

  function finir() {
    elQ.textContent = score === QUESTIONS.length
      ? '🎉 Parfait, sans faute !'
      : 'Terminé : ' + score + '/' + QUESTIONS.length + '. Prêt à rejouer ?';
    elR.innerHTML = '';
    document.getElementById('rejouer').hidden = false;
  }

  document.getElementById('rejouer').addEventListener('click', function () {
    index = 0; score = 0; elScore.textContent = '0';
    this.hidden = true; poser();
  });

  poser();
})();`,
  }
}

// ── Portfolio ────────────────────────────────────────────────────────────────

function portfolio(ctx: PageCtx): GeneratedWebpage {
  const accent = accentFor(ctx.text)
  return {
    description: 'page portfolio responsive (projets, filtres, contact)',
    html: `
<header class="hero container">
  <div class="avatar">👤</div>
  <h1>Mon portfolio</h1>
  <p class="tagline">Créateur — je construis des expériences de ${ctx.topic || 'web'}.</p>
  <div class="hero-actions"><a class="btn" href="#projets">Voir mes projets</a></div>
</header>
<section id="projets" class="container section">
  <h2>Projets</h2>
  <div class="filtres">
    <button data-categorie="tout" class="actif">Tout</button>
    <button data-categorie="jeu">Jeux</button>
    <button data-categorie="web">Web</button>
    <button data-categorie="outil">Outils</button>
  </div>
  <div class="grille" id="grille">
    <article class="carte projet" data-categorie="jeu"><h3>🎮 Obby des tempêtes</h3><p>Un obby Roblox avec 12 checkpoints, vent animé et leaderboard.</p></article>
    <article class="carte projet" data-categorie="web"><h3>🌐 Site vitrine</h3><p>Landing page rapide, 100/100 Lighthouse.</p></article>
    <article class="carte projet" data-categorie="outil"><h3>🧰 Calculateur de craft</h3><p>Script Python qui optimise les recettes du jeu.</p></article>
    <article class="carte projet" data-categorie="jeu"><h3>⚔️ Arena du crépuscule</h3><p>Système de combat + économie en Luau.</p></article>
    <article class="carte projet" data-categorie="web"><h3>📊 Dashboard météo</h3><p>Page HTML qui affiche des jauges animées.</p></article>
    <article class="carte projet" data-categorie="outil"><h3>⏱️ Pomodoro custom</h3><p>Minuteur web avec anneau de progression.</p></article>
  </div>
</section>
<footer class="footer container"><p>Construit avec ♥ par NEXUS — IA locale</p></footer>`,
    css: `
${BASE_CSS(accent, true)}
.hero { text-align: center; padding: 80px 20px 40px; }
.avatar { width: 90px; height: 90px; font-size: 3rem; line-height: 90px; border-radius: 50%; background: var(--accent-soft); margin: 0 auto 18px; }
.tagline { color: var(--muted); margin-top: 8px; }
.hero-actions { margin-top: 22px; text-decoration: none; }
.section { padding: 50px 20px; }
h2 { margin-bottom: 24px; }
.filtres { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
.filtres button { padding: 8px 16px; border-radius: 999px; border: 1px solid var(--border); background: transparent; color: var(--muted); cursor: pointer; }
.filtres button.actif { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
.grille { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 16px; }
.projet.caché, .projet.cache { display: none; }
.footer { text-align: center; color: var(--muted); padding: 26px; }`,
    js: `(function () {
  'use strict';
  document.querySelectorAll('.filtres button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.filtres button').forEach(function (b) { b.classList.remove('actif'); });
      btn.classList.add('actif');
      var cat = btn.getAttribute('data-categorie');
      document.querySelectorAll('.projet').forEach(function (carte) {
        var match = cat === 'tout' || carte.getAttribute('data-categorie') === cat;
        carte.style.display = match ? '' : 'none';
      });
    });
  });
})();`,
  }
}

// ── Point d'entrée ───────────────────────────────────────────────────────────

/** Choisit le template adapté à la demande. */
export function generateWebpageLocal(text: string, topic: string): GeneratedWebpage {
  const t = text.toLowerCase()
  if (/todo|t[âa]che|liste de (choses|courses)|to.?do/.test(t)) return todoApp({ text, topic })
  if (/pomodoro|minuteur|timer|chron/.test(t)) return pomodoro({ text, topic })
  if (/quiz|qcm|questionnaire/.test(t)) return quiz({ text, topic })
  if (/portfolio/.test(t)) return portfolio({ text, topic })
  return landing({ text, topic })
}
