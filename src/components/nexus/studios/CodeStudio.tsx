'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  Code2,
  Download,
  Eraser,
  FileCode2,
  History,
  Inbox,
  Loader2,
  Paintbrush,
  Play,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Terminal,
  Trash2,
  Wand2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { uid, useNexusStore } from '@/lib/store'
import type { CodeFiles } from '@/lib/nexus-types'
import { EDITOR_LANGUAGES } from '@/lib/nexus-types'
import { codeFileEntries, collapseDiff, diffLines, diffStats } from '@/lib/diff'
import { cn } from '@/lib/utils'

interface LogEntry {
  id: number
  level: 'log' | 'info' | 'warn' | 'error'
  text: string
}

interface VersionSnapshot {
  id: string
  at: number
  files: CodeFiles
}

const VERSIONS_KEY = 'nexus-code-versions'

const TEMPLATES: { name: string; files: CodeFiles }[] = [
  {
    name: 'Page vierge',
    files: {
      html: '<div class="carte">\n  <h1>Bonjour NEXUS</h1>\n  <p>Commencez à coder…</p>\n</div>',
      css: 'body {\n  display: grid;\n  place-items: center;\n  min-height: 100vh;\n  margin: 0;\n  font-family: system-ui, sans-serif;\n  background: #09090b;\n  color: #e4e4e7;\n}\n.carte {\n  padding: 2rem 3rem;\n  border-radius: 1rem;\n  background: #18181b;\n  text-align: center;\n}',
      js: "console.log('Prêt à coder !');",
    },
  },
  {
    name: 'Compteur animé',
    files: {
      html: '<div class="carte">\n  <h1>Compteur</h1>\n  <div id="valeur">0</div>\n  <div class="boutons">\n    <button id="moins">−</button>\n    <button id="plus">+</button>\n  </div>\n</div>',
      css: 'body { display: grid; place-items: center; min-height: 100vh; margin: 0; background: #09090b; font-family: system-ui, sans-serif; }\n.carte { text-align: center; padding: 2rem 3rem; border-radius: 1.2rem; background: #18181b; color: #fafafa; }\n#valeur { font-size: 4rem; font-weight: 800; margin: 0.5rem 0 1rem; color: #a855f7; }\nbutton { font-size: 1.4rem; width: 3rem; height: 3rem; border: none; border-radius: 0.6rem; margin: 0 0.3rem; background: #a855f7; color: white; cursor: pointer; transition: transform 0.15s; }\nbutton:hover { transform: scale(1.1); }',
      js: "let n = 0;\nconst el = document.getElementById('valeur');\ndocument.getElementById('plus').onclick = () => { n++; maj(); };\ndocument.getElementById('moins').onclick = () => { n--; maj(); };\nfunction maj() { el.textContent = n; el.animate([{ transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 200 }); }\nconsole.log('Compteur initialisé');",
    },
  },
  {
    name: 'Particules',
    files: {
      html: '<canvas id="scene"></canvas>',
      css: 'body { margin: 0; overflow: hidden; background: #09090b; }\ncanvas { display: block; }',
      js: "const c = document.getElementById('scene');\nconst ctx = c.getContext('2d');\nlet W, H;\nfunction taille() { W = c.width = innerWidth; H = c.height = innerHeight; }\ntaille();\naddEventListener('resize', taille);\nconst couleurs = ['#a855f7', '#ec4899', '#10b981', '#f59e0b'];\nconst parts = Array.from({ length: 80 }, () => ({\n  x: Math.random() * W, y: Math.random() * H,\n  vx: (Math.random() - 0.5) * 1.5, vy: (Math.random() - 0.5) * 1.5,\n  r: 2 + Math.random() * 3,\n  couleur: couleurs[Math.floor(Math.random() * couleurs.length)],\n}));\nfunction boucle() {\n  ctx.fillStyle = 'rgba(9,9,11,0.25)';\n  ctx.fillRect(0, 0, W, H);\n  for (const p of parts) {\n    p.x += p.vx; p.y += p.vy;\n    if (p.x < 0 || p.x > W) p.vx *= -1;\n    if (p.y < 0 || p.y > H) p.vy *= -1;\n    ctx.beginPath();\n    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);\n    ctx.fillStyle = p.couleur;\n    ctx.fill();\n  }\n  requestAnimationFrame(boucle);\n}\nboucle();\nconsole.log('Particules lancées');",
    },
  },
]

const CONSOLE_SHIM = `<script>
(function(){
  var send = function(level, args){
    try { parent.postMessage({ source: 'nexus-console', level: level, text: args.map(function(a){ try { return typeof a === 'object' ? JSON.stringify(a) : String(a) } catch(e){ return String(a) } }).join(' ') }, '*') } catch(e){}
  };
  var fmt = function(v){
    if (v === undefined) return 'undefined';
    try { return typeof v === 'object' ? JSON.stringify(v, null, 1) : String(v); } catch(e){ return String(v); }
  };
  ['log','info','warn','error'].forEach(function(level){
    var orig = console[level] ? console[level].bind(console) : function(){};
    console[level] = function(){ send(level, [].slice.call(arguments)); orig.apply(null, arguments); };
  });
  window.addEventListener('error', function(e){ send('error', [e.message]); });
  // Terminal interactif : évalue les commandes envoyées depuis la console de NEXUS
  window.addEventListener('message', function(e){
    if (!e.data || e.data.source !== 'nexus-repl') return;
    var code = String(e.data.code || '');
    if (!code) return;
    // Return implicite sur la dernière expression top-level (comme les DevTools)
    if (!/\\breturn\\b/.test(code)) {
      // trouve le dernier ';' de niveau 0 (en ignorant chaînes et imbrications)
      var depth = 0, q = null, esc = false, last = -1;
      for (var i = 0; i < code.length; i++) {
        var ch = code[i];
        if (q) {
          if (esc) { esc = false; continue; }
          if (ch === '\\\\') { esc = true; continue; }
          if (ch === q) q = null;
          continue;
        }
        if (ch === '\\'' || ch === '"') { q = ch; continue; }
        if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
        if (ch === ')' || ch === ']' || ch === '}') { depth--; continue; }
        if (ch === ';' && depth === 0) last = i;
      }
      var tail = (last === -1 ? code : code.slice(last + 1)).trim();
      var codeEnd = code.replace(/[\\s;]+$/, '').slice(-1);
      var startsKeyword = /^(var|let|const|if|for|while|function|switch|try|throw|return)\\b/.test(tail);
      if (tail && !startsKeyword && codeEnd !== '}' && codeEnd !== '{') {
        code = (last === -1 ? '' : code.slice(0, last + 1)) + ' return (' + tail + ')';
      }
    }
    if (/\\bawait\\b/.test(code)) {
      try {
        var fn = new Function('return (async()=>{\\n' + code + '\\n})()');
        fn().then(function(r){ send('log', ['⟵ ' + fmt(r)]); }).catch(function(err){ send('error', [fmt(err && err.message ? err.message : err)]); });
      } catch(err){ send('error', [fmt(err && err.message ? err.message : err)]); }
    } else {
      try { var r = window.eval(code); send('log', ['⟵ ' + fmt(r)]); }
      catch(err){ send('error', [fmt(err && err.message ? err.message : err)]); }
    }
  });
})();
<\/script>`

export function CodeStudio() {
  const pendingCode = useNexusStore((s) => s.pendingCode)
  const setPendingCode = useNexusStore((s) => s.setPendingCode)
  // Les fichiers vivent DANS le store : les agents peuvent les lire (mode
  // PROPOSITION) et ils survivent aux rechargements de page.
  const files = useNexusStore((s) => s.codeFiles)
  const setFiles = useNexusStore((s) => s.setCodeFiles)
  const pendingProposal = useNexusStore((s) => s.pendingProposal)
  const setPendingProposal = useNexusStore((s) => s.setPendingProposal)

  const [tab, setTab] = useState<'html' | 'css' | 'js'>('html')
  const [proposalOpen, setProposalOpen] = useState(false)

  // Mode script : le code de l'agent peut être un programme (Python, Lua…) et non
  // une page web — l'aperçu live est remplacé par une fiche de téléchargement.
  const isScript = Boolean(files.language) && !['web', 'html'].includes(files.language ?? '')
  const [srcDoc, setSrcDoc] = useState('')
  const [runId, setRunId] = useState(0)
  const [autoRun, setAutoRun] = useState(true)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [replInput, setReplInput] = useState('')
  const [replHistory, setReplHistory] = useState<string[]>([])
  const [versions, setVersions] = useState<VersionSnapshot[]>([])
  const [versionsOpen, setVersionsOpen] = useState(false)

  const logIdRef = useRef(0)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const versionsRef = useRef<VersionSnapshot[]>([])

  // Versions persistées localement (type Git : snapshots restaurables)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(VERSIONS_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as VersionSnapshot[]
        if (Array.isArray(parsed)) {
          const clean = parsed.filter((v) => v && v.files).slice(0, 20)
          versionsRef.current = clean
          setVersions(clean)
        }
      }
    } catch {
      /* versions corrompues : ignorées */
    }
  }, [])

  const pushVersion = useCallback((snapshotFiles: CodeFiles) => {
    const snap: VersionSnapshot = {
      id: uid(),
      at: Date.now(),
      files: { ...snapshotFiles },
    }
    const next = [snap, ...versionsRef.current].slice(0, 20)
    versionsRef.current = next
    setVersions(next)
    try {
      localStorage.setItem(VERSIONS_KEY, JSON.stringify(next))
    } catch {
      /* quota dépassé : versions en mémoire seulement */
    }
  }, [])

  const deleteVersion = (id: string) => {
    const next = versionsRef.current.filter((v) => v.id !== id)
    versionsRef.current = next
    setVersions(next)
    try {
      localStorage.setItem(VERSIONS_KEY, JSON.stringify(next))
    } catch {
      /* ignoré */
    }
  }

  const restoreVersion = (v: VersionSnapshot) => {
    setFiles(v.files)
    setVersionsOpen(false)
    toast.success(`Version du ${new Date(v.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} restaurée`)
  }

  const composeDoc = useCallback(
    (withConsole: boolean) => {
      return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
${files.css}
</style>
</head>
<body>
${files.html}
${withConsole ? CONSOLE_SHIM : ''}
<script>
try {
${files.js}
} catch (e) { console.error(e.message); }
<\/script>
</body>
</html>`
    },
    [files]
  )

  // Exécution : runId change → l'iframe est RECÉÉE (key) → jamais d'iframe "morte"
  // (une simple mutation de l'attribut srcdoc peut être ignorée par le navigateur
  // si l'iframe est déjà dans un état de chargement, tuant tout le canal console).
  const run = useCallback(() => {
    setLogs([])
    setSrcDoc(composeDoc(true))
    setRunId((n) => n + 1)
  }, [composeDoc])

  useEffect(() => {
    if (!autoRun) return
    const t = setTimeout(() => {
      setLogs([])
      setSrcDoc(composeDoc(true))
      setRunId((n) => n + 1)
    }, 700)
    return () => clearTimeout(t)
  }, [autoRun, composeDoc])

  // Premier rendu
  useEffect(() => {
    setSrcDoc(composeDoc(true))
  }, [])

  // Console de l'iframe
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data
      if (!d || d.source !== 'nexus-console') return
      setLogs((prev) => [
        ...prev.slice(-59),
        { id: logIdRef.current++, level: d.level ?? 'log', text: String(d.text ?? '') },
      ])
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Code envoyé par l'agent (version sauvegardée avant remplacement)
  useEffect(() => {
    if (pendingCode) {
      pushVersion(files)
      setFiles(pendingCode)
      setPendingCode(null)
      toast.success('Code de l’agent chargé dans le studio — version précédente sauvegardée')
    }
  }, [pendingCode, setPendingCode, pushVersion, setFiles, files])

  // Une proposition d'agent vient d'arriver → on ouvre le panneau automatiquement
  useEffect(() => {
    if (pendingProposal) setProposalOpen(true)
  }, [pendingProposal])

  const applyProposal = useCallback(() => {
    if (!pendingProposal) return
    pushVersion(files)
    setFiles(pendingProposal.proposed)
    setPendingProposal(null)
    setProposalOpen(false)
    toast.success(`Proposition de ${pendingProposal.agentEmoji} ${pendingProposal.agentName} VALIDÉE — code mis à jour (version précédente sauvegardée)`)
  }, [pendingProposal, files, pushVersion, setFiles, setPendingProposal])

  const rejectProposal = useCallback(() => {
    if (!pendingProposal) return
    setPendingProposal(null)
    setProposalOpen(false)
    toast.info(`Proposition de ${pendingProposal.agentName} rejetée — ton code reste inchangé`)
  }, [pendingProposal, setPendingProposal])

  /** « + Nouveau script » : démarre un fichier dans l'un des 20 langages. */
  const startScript = useCallback(
    (langId: string) => {
      const lang = EDITOR_LANGUAGES.find((l) => l.id === langId)
      if (!lang) return
      pushVersion(files)
      setFiles({ html: '', css: '', js: lang.stub, language: lang.id, filename: `main.${lang.ext}` })
      setTab('js')
      toast.success(`Nouveau script ${lang.emoji} ${lang.label} créé — main.${lang.ext}`)
    },
    [files, pushVersion, setFiles]
  )

  const backToWeb = useCallback(() => {
    pushVersion(files)
    setFiles({ ...TEMPLATES[0].files })
    setTab('html')
    toast.success('Retour au mode page web (HTML/CSS/JS)')
  }, [files, pushVersion, setFiles])

  const onTabKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const el = e.currentTarget
      const start = el.selectionStart
      const end = el.selectionEnd
      const value = el.value
      const next = value.slice(0, start) + '  ' + value.slice(end)
      setFiles((f) => ({ ...f, [tab]: next }))
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 2
      })
    }
  }

  const generateAI = async () => {
    const prompt = aiPrompt.trim()
    if (!prompt || aiLoading) return
    setAiLoading(true)
    pushVersion(files)
    try {
      const res = await fetch('/api/tools/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Génération impossible')
      setFiles(data.files as CodeFiles)
      setAiPrompt('')
      toast.success('Code généré — aperçu mis à jour (version précédente sauvegardée)')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur IA')
    } finally {
      setAiLoading(false)
    }
  }

  /** Terminal interactif : commandes locales ou évaluation JS dans la page. */
  const pushLog = (level: LogEntry['level'], text: string) => {
    setLogs((prev) => [...prev.slice(-79), { id: logIdRef.current++, level, text }])
  }

  const sendRepl = () => {
    const code = replInput.trim()
    if (!code) return
    setReplHistory((h) => [...h.slice(-49), code])
    setReplInput('')
    pushLog('info', `❯ ${code}`)
    if (code === ':help') {
      pushLog('log', 'Commandes : :clear (vider), :reset (relancer la page), :history (historique des commandes), :help (aide). Tout le reste est évalué en JavaScript directement dans la page (await supporté).')
      return
    }
    if (code === ':clear') {
      setLogs([])
      return
    }
    if (code === ':reset') {
      setLogs([])
      setSrcDoc(composeDoc(true))
      pushLog('info', 'Page relancée — état réinitialisé.')
      return
    }
    if (code === ':history') {
      if (replHistory.length === 0) pushLog('log', 'Aucune commande précédente.')
      replHistory.forEach((h, i) => pushLog('log', `${i + 1}. ${h}`))
      return
    }
    iframeRef.current?.contentWindow?.postMessage({ source: 'nexus-repl', code }, '*')
  }

  const replKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      sendRepl()
    } else if (e.key === 'ArrowUp' && replHistory.length > 0) {
      e.preventDefault()
      setReplInput(replHistory[replHistory.length - 1])
    }
  }

  const download = () => {
    if (isScript) {
      const blob = new Blob([files.js], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = files.filename || `script.${files.language ?? 'txt'}`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`Script « ${a.download} » téléchargé`)
      return
    }
    const blob = new Blob([composeDoc(false)], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'nexus-page.html'
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Page HTML téléchargée')
  }

  const TABS: { id: 'html' | 'css' | 'js'; label: string; icon: typeof Code2 }[] = useMemo(
    () =>
      isScript
        ? [{ id: 'js' as const, label: files.language ?? 'Script', icon: FileCode2 }]
        : [
            { id: 'html', label: 'HTML', icon: FileCode2 },
            { id: 'css', label: 'CSS', icon: Paintbrush },
            { id: 'js', label: 'JS', icon: Code2 },
          ],
    [isScript, files.language]
  )

  return (
    <div className="flex h-full flex-col">
      {/* Barre supérieure */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 bg-card/50 px-3 py-2.5">
        <div className="flex items-center gap-1" role="tablist" aria-label="Fichiers du projet">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                tab === t.id ? 'bg-accent text-violet-300' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground/80'
              )}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* + Nouveau script : 20 langages disponibles dans l'éditeur */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-8 gap-1.5 border-border text-xs hover:bg-accent">
                <Plus className="h-3 w-3" />
                <span className="hidden sm:inline">Nouveau script</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-y-auto">
              <DropdownMenuLabel className="text-[11px] text-muted-foreground">Démarrer un script…</DropdownMenuLabel>
              {EDITOR_LANGUAGES.map((l) => (
                <DropdownMenuItem key={l.id} onClick={() => startScript(l.id)} className="gap-2 text-xs">
                  <span>{l.emoji}</span>
                  <span className="flex-1">{l.label}</span>
                  <span className="text-[10px] text-muted-foreground/60">.{l.ext}</span>
                  {files.language === l.id && <Check className="h-3 w-3 text-violet-400" />}
                </DropdownMenuItem>
              ))}
              {!isScript && (
                <DropdownMenuItem onClick={backToWeb} className="gap-2 text-xs">
                  <span>🌐</span>
                  <span className="flex-1">Page web (HTML/CSS/JS)</span>
                  <Check className="h-3 w-3 text-violet-400" />
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Propositions d'agents (diff → valider/rejeter) */}
          <Button
            size="sm"
            variant="outline"
            className={cn(
              'relative h-8 gap-1.5 border-border text-xs hover:bg-accent',
              pendingProposal && 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300',
              proposalOpen && 'z-50 bg-accent text-violet-300'
            )}
            onClick={() => setProposalOpen((v) => !v)}
            aria-expanded={proposalOpen}
            aria-label="Propositions de code des agents"
          >
            <Inbox className="h-3 w-3" />
            <span className="hidden sm:inline">Propositions</span>
            {pendingProposal && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-emerald-400" />}
          </Button>

          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={autoRun} onCheckedChange={setAutoRun} aria-label="Exécution automatique" />
            Auto
          </label>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 border-border text-xs hover:bg-accent" onClick={run}>
            <Play className="h-3 w-3" /> Exécuter
          </Button>
          <div className="relative">
            <Button
              size="sm"
              variant="outline"
              className={cn(
                'relative h-8 gap-1.5 border-border text-xs hover:bg-accent',
                versionsOpen && 'z-50 bg-accent text-violet-300'
              )}
              onClick={() => setVersionsOpen((v) => !v)}
              aria-expanded={versionsOpen}
              aria-label="Historique des versions"
            >
              <History className="h-3 w-3" />
              <span className="hidden sm:inline">Versions</span>
              {versions.length > 0 && (
                <span className="rounded-full bg-violet-500/15 px-1.5 text-[10px] font-semibold text-violet-300">
                  {versions.length}
                </span>
              )}
            </Button>
            {versionsOpen && (
              <>
                <button
                  className="fixed inset-0 z-40 cursor-default"
                  aria-hidden="true"
                  onClick={() => setVersionsOpen(false)}
                />
                <div className="absolute right-0 top-9 z-50 w-80 rounded-xl border border-border bg-card p-3 shadow-2xl">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-semibold text-foreground">Versions (type Git)</p>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 gap-1 px-2 text-[10px] text-emerald-300 hover:bg-emerald-500/10"
                      onClick={() => {
                        pushVersion(files)
                        toast.success('Version actuelle enregistrée')
                      }}
                    >
                      <Save className="h-3 w-3" /> Sauvegarder
                    </Button>
                  </div>
                  {versions.length === 0 ? (
                    <p className="py-4 text-center text-[11px] leading-relaxed text-muted-foreground">
                      Aucune version enregistrée. Une version est capturée automatiquement
                      avant chaque génération IA ou code d’agent.
                    </p>
                  ) : (
                    <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                      {versions.map((v, i) => (
                        <li
                          key={v.id}
                          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 hover:bg-accent/60"
                        >
                          <button
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            onClick={() => restoreVersion(v)}
                          >
                            <RotateCcw className="h-3 w-3 shrink-0 text-violet-400" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[11px] font-medium text-foreground/90">
                                #{versions.length - i} · {new Date(v.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                              </span>
                              <span className="text-[10px] text-muted-foreground/70">
                                {v.files.html.length + v.files.css.length + v.files.js.length} caractères
                              </span>
                            </span>
                          </button>
                          <button
                            onClick={() => deleteVersion(v.id)}
                            className="shrink-0 rounded-md p-1 text-muted-foreground/40 hover:text-rose-400"
                            aria-label="Supprimer cette version"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 border-border text-xs text-violet-300 hover:bg-violet-500/10"
            onClick={() => setAiOpen((v) => !v)}
          >
            <Sparkles className="h-3 w-3" /> IA
          </Button>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 border-border text-xs hover:bg-accent" onClick={download}>
            <Download className="h-3 w-3" /> {isScript ? (files.filename || 'Script') : 'HTML'}
          </Button>
        </div>
      </div>

      {/* Barre IA */}
      {aiOpen && (
        <div className="flex items-center gap-2 border-b border-border/70 bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 px-3 py-2">
          <Wand2 className="h-4 w-4 shrink-0 text-violet-400" />
          <Input
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && generateAI()}
            placeholder="Décrivez la page à créer… (ex : un jeu de memory avec des animaux)"
            className="h-9 border-border bg-muted/60 text-sm"
            aria-label="Description de la page à générer"
          />
          <Button
            size="sm"
            className="h-9 shrink-0 gap-1.5 bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 text-white hover:opacity-90"
            onClick={generateAI}
            disabled={aiLoading || aiPrompt.trim().length === 0}
          >
            {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            Générer
          </Button>
        </div>
      )}

      {/* Panneau Propositions : diff relu + validation (jamais d'écriture sans validation) */}
      {proposalOpen && (
        <div className="border-b border-emerald-500/30 bg-emerald-500/5">
          {pendingProposal ? (
            <div className="flex flex-col gap-2 px-3 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
                  💼 Proposition de {pendingProposal.agentEmoji} {pendingProposal.agentName}
                </span>
                <span className="text-xs text-foreground/80">— {pendingProposal.title}</span>
                <span className="ml-auto flex items-center gap-1.5">
                  <Button size="sm" className="h-7 gap-1 bg-emerald-600 px-3 text-xs text-white hover:bg-emerald-500" onClick={applyProposal}>
                    <Check className="h-3 w-3" /> Valider et appliquer
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 gap-1 px-3 text-xs text-rose-400 hover:bg-rose-500/10" onClick={rejectProposal}>
                    <X className="h-3 w-3" /> Rejeter
                  </Button>
                </span>
              </div>
              {pendingProposal.note && (
                <p className="rounded-lg border border-border bg-card/60 px-2.5 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  {pendingProposal.note}
                </p>
              )}
              <ProposalDiff base={pendingProposal.base} proposed={pendingProposal.proposed} />
            </div>
          ) : (
            <p className="px-3 py-3 text-xs text-muted-foreground">
              Aucune proposition en attente. Quand tu demandes à un agent d'améliorer ton code (discussion avec un agent), sa
              version apparaît ici sous forme de diff — tu relis, puis tu valides ou rejettes. Ton code n'est jamais modifié sans toi.
            </p>
          )}
        </div>
      )}

      {/* Corps */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Éditeur */}
        <div className="flex min-h-[220px] w-full flex-col border-b border-border/70 lg:w-1/2 lg:border-b-0 lg:border-r">
          <textarea
            value={files[tab]}
            onChange={(e) => setFiles((f) => ({ ...f, [tab]: e.target.value }))}
            onKeyDown={onTabKey}
            spellCheck={false}
            aria-label={`Éditeur ${tab.toUpperCase()}`}
            className="h-full min-h-[220px] w-full flex-1 resize-none bg-zinc-950 p-4 font-mono text-[13px] leading-relaxed text-foreground outline-none"
          />
          {!isScript && (
            <div className="flex items-center gap-2 border-t border-border/70 px-3 py-2">
              <span className="text-[10px] text-muted-foreground/70">Modèles :</span>
              {TEMPLATES.map((t) => (
                <Button
                  key={t.name}
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => {
                    setFiles(t.files)
                    toast.success(`Modèle « ${t.name} » chargé`)
                  }}
                >
                  {t.name}
                </Button>
              ))}
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto h-6 gap-1 px-2 text-[10px] text-rose-400 hover:bg-rose-500/10"
                onClick={() => setFiles(TEMPLATES[0].files)}
              >
                <Eraser className="h-3 w-3" /> Vider
              </Button>
            </div>
          )}
        </div>

        {/* Aperçu + console (ou fiche script) */}
        <div className="flex min-h-0 w-full flex-1 flex-col">
          {isScript ? (
            <div className="flex min-h-[220px] flex-1 flex-col items-center justify-center gap-3 overflow-y-auto p-6 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-blue-600">
                <FileCode2 className="h-6 w-6 text-white" />
              </span>
              <p className="text-sm font-semibold text-foreground">{files.filename || 'Script'}</p>
              <p className="rounded-full border border-border bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
                Langage : {files.language}
              </p>
              <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
                Ce programme n’est pas une page web : il ne s’exécute pas dans le
                navigateur. Téléchargez-le puis exécutez-le avec l’interpréteur du
                langage (ex : <code className="rounded bg-muted px-1">python {files.filename ?? 'script.py'}</code>
                {' '}ou dans Roblox Studio pour du Luau).
              </p>
              <Button size="sm" className="gap-1.5 bg-sky-500 text-white hover:bg-sky-600" onClick={download}>
                <Download className="h-3.5 w-3.5" />
                Télécharger le script
              </Button>
            </div>
          ) : (
            <>
              <div className="min-h-[220px] flex-1 bg-white">
                <iframe
                  key={`preview-${runId}-${srcDoc.length}-${srcDoc.slice(0, 64)}`}
                  ref={iframeRef}
                  title="Aperçu de la page"
                  srcDoc={srcDoc}
                  sandbox="allow-scripts allow-modals"
                  className="h-full w-full border-0"
                />
              </div>
              <div className="flex h-44 min-h-44 flex-col border-t border-border/70 bg-zinc-950 lg:h-52">
                <div className="flex items-center justify-between border-b border-border/70 px-3 py-1.5">
                  <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <Terminal className="h-3 w-3" />
                    Terminal ({logs.length})
                  </span>
                  <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[10px] text-muted-foreground hover:bg-accent" onClick={() => setLogs([])}>
                    <Eraser className="h-3 w-3" /> Effacer
                  </Button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 font-mono text-[11px] leading-relaxed" style={{ scrollbarWidth: 'thin' }}>
                  {logs.length === 0 ? (
                    <p className="px-1 text-muted-foreground/70">
                      Sorties console, erreurs et commandes apparaîtront ici. Tapez :help pour l’aide.
                    </p>
                  ) : (
                    logs.map((l) => (
                      <p
                        key={l.id}
                        className={cn(
                          'border-b border-zinc-900 px-1 py-0.5 break-words whitespace-pre-wrap',
                          l.level === 'error' && 'text-rose-400',
                          l.level === 'warn' && 'text-amber-400',
                          (l.level === 'log' || l.level === 'info') && 'text-foreground/80'
                        )}
                      >
                        {l.text}
                      </p>
                    ))
                  )}
                </div>
                <div className="flex items-center gap-2 border-t border-border/70 px-3 py-2">
                  <Terminal className="h-3.5 w-3.5 shrink-0 text-violet-400" />
                  <input
                    value={replInput}
                    onChange={(e) => setReplInput(e.target.value)}
                    onKeyDown={replKeyDown}
                    placeholder="JavaScript dans la page… (:help pour l’aide)"
                    aria-label="Console interactive — évalue du JavaScript dans la page"
                    spellCheck={false}
                    className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-foreground placeholder:text-muted-foreground/50 outline-none"
                  />
                  <kbd className="hidden shrink-0 rounded border border-border px-1 text-[9px] text-muted-foreground/60 sm:inline">
                    ↑ historique
                  </kbd>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Diff complet de la proposition : pour chaque fichier modifié (HTML/CSS/JS ou
 * script), lignes ajoutées (vert) / supprimées (rouge), plages inchangées
 * réduites. L'utilisateur voit EXACTEMENT ce qui change avant de valider.
 */
function ProposalDiff({ base, proposed }: { base: CodeFiles; proposed: CodeFiles }) {
  const sections = useMemo(() => {
    return codeFileEntries({ html: base.html, css: base.css, js: base.js })
      .map((entry) => {
        const proposedEntry = codeFileEntries({ html: proposed.html, css: proposed.css, js: proposed.js }).find((e) => e.key === entry.key)!
        const lines = diffLines(entry.content, proposedEntry.content)
        return { key: entry.key, label: entry.label, lines, stats: diffStats(lines) }
      })
      .filter((s) => s.stats.added > 0 || s.stats.removed > 0)
  }, [base, proposed])

  if (sections.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-card/60 px-2.5 py-2 text-[11px] text-muted-foreground">
        Aucune différence détectée avec le code actuel — la proposition est identique.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {sections.map((s) => {
        const collapsed = collapseDiff(s.lines, 3)
        return (
          <div key={s.key} className="overflow-hidden rounded-lg border border-border bg-zinc-950">
            <div className="flex items-center gap-2 border-b border-border/70 bg-card/70 px-2.5 py-1.5">
              <span className="text-[11px] font-semibold text-foreground/90">{s.label}</span>
              <span className="text-[10px] font-medium text-emerald-400">+{s.stats.added}</span>
              <span className="text-[10px] font-medium text-rose-400">−{s.stats.removed}</span>
            </div>
            <div className="max-h-72 overflow-y-auto p-0 font-mono text-[11px] leading-[1.5]" style={{ scrollbarWidth: 'thin' }}>
              {collapsed.map((line, i) =>
                line.type === 'gap' ? (
                  <p key={`gap-${i}`} className="bg-card/40 px-3 py-0.5 text-center text-[10px] italic text-muted-foreground/60">
                    ⋯ {line.count} ligne{line.count > 1 ? 's' : ''} inchangée{line.count > 1 ? 's' : ''} ⋯
                  </p>
                ) : (
                  <p
                    key={`l-${i}`}
                    className={cn(
                      'whitespace-pre-wrap break-words px-3',
                      line.type === 'add' && 'bg-emerald-500/15 text-emerald-300',
                      line.type === 'del' && 'bg-rose-500/15 text-rose-300',
                      line.type === 'ctx' && 'text-foreground/50'
                    )}
                  >
                    <span className="mr-2 inline-block w-8 select-none text-right text-[9px] text-muted-foreground/40">
                      {line.type === 'add' ? `+${line.newNo ?? ''}` : line.type === 'del' ? `−${line.oldNo ?? ''}` : line.oldNo}
                    </span>
                    {line.text || ' '}
                  </p>
                )
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
