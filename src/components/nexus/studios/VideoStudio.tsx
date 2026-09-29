'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Clapperboard,
  Download,
  Film,
  Loader2,
  RotateCcw,
  Scissors,
  Sparkles,
  Upload,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useNexusStore } from '@/lib/store'
import { cn } from '@/lib/utils'

interface Adjustments {
  brightness: number
  contrast: number
  saturate: number
  blur: number
  grayscale: number
  sepia: number
  hueRotate: number
  invert: number
}

const DEFAULT_ADJ: Adjustments = {
  brightness: 100, contrast: 100, saturate: 100, blur: 0,
  grayscale: 0, sepia: 0, hueRotate: 0, invert: 0,
}

const fmt = (t: number) => {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function VideoStudio() {
  const pendingVideo = useNexusStore((s) => s.pendingVideo)
  const setPendingVideo = useNexusStore((s) => s.setPendingVideo)

  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [fileName, setFileName] = useState('video')
  const [duration, setDuration] = useState(0)
  const [dims, setDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(0)
  const [speed, setSpeed] = useState('1')
  const [adj, setAdj] = useState<Adjustments>(DEFAULT_ADJ)
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [exportedUrl, setExportedUrl] = useState<string | null>(null)

  // Génération par IA (texte → vidéo, moteur procédural local + ffmpeg)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiDuration, setAiDuration] = useState('5')
  const [aiQuality, setAiQuality] = useState<'speed' | 'quality'>('speed')
  const [aiVariant, setAiVariant] = useState(0)
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiStatus, setAiStatus] = useState('')
  const [aiLastPrompt, setAiLastPrompt] = useState('')

  const videoRef = useRef<HTMLVideoElement>(null)
  const rafRef = useRef<number | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const audioNodeRef = useRef<MediaElementAudioSourceNode | null>(null)

  /** Charge une vidéo dans l'éditeur : URL locale (moteur NEXUS) → blob direct ;
   *  URL distante → relais same-origin pour contourner l'absence de CORS. */
  const loadRemoteVideo = async (url: string) => {
    const fetchUrl = url.startsWith('/') ? url : `/api/tools/video/download?url=${encodeURIComponent(url)}`
    try {
      const res = await fetch(fetchUrl)
      if (!res.ok) throw new Error('téléchargement impossible')
      const blob = await res.blob()
      setVideoUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return URL.createObjectURL(blob)
      })
      setFileName('video-ia')
      setAdj(DEFAULT_ADJ)
      setExportedUrl(null)
      toast.success('Vidéo générée et chargée dans le studio')
    } catch {
      // Lecture directe à distance (l'export local peut être limité par CORS)
      setVideoUrl(url)
      setFileName('video-ia')
      toast.info('Vidéo chargée en lecture directe')
    }
  }

  // Vidéo envoyée par l'agent (carte « Studio Vidéo » du chat)
  useEffect(() => {
    if (pendingVideo) {
      const url = pendingVideo
      setPendingVideo(null)
      loadRemoteVideo(url)
    }
  }, [pendingVideo, setPendingVideo])

  const generateAI = async (variant = 0) => {
    const prompt = (aiPrompt.trim() || (variant > 0 ? aiLastPrompt : '')).trim()
    if (!prompt || aiGenerating) return
    setAiGenerating(true)
    setAiStatus('Le moteur tourne : détection du thème…')
    setAiVariant(variant)
    if (variant === 0) setAiLastPrompt(prompt)
    try {
      const res = await fetch('/api/tools/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, duration: Number(aiDuration) === 10 ? 10 : 5, quality: aiQuality, variant }),
      })
      const data = await res.json()
      if (!res.ok || !data.taskId) throw new Error(data.error || 'Tâche non créée')

      const startedAt = Date.now()
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 2000))
        const pollRes = await fetch(`/api/tools/video?taskId=${encodeURIComponent(String(data.taskId))}`)
        const state = (await pollRes.json()) as { status?: string; url?: string; error?: string; elapsed?: number }
        if (state.status === 'SUCCESS' && state.url) {
          setAiPrompt('')
          toast.success('Vidéo générée avec succès')
          await loadRemoteVideo(state.url)
          return
        }
        if (state.status === 'FAIL') throw new Error(state.error || 'La génération vidéo a échoué')
        setAiStatus(`Rendu local en cours… ${state.elapsed ?? Math.round((Date.now() - startedAt) / 1000)} s (rendu + encodage ffmpeg)`)
      }
      throw new Error('Délai de génération dépassé')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur de génération')
    } finally {
      setAiGenerating(false)
      setAiStatus('')
    }
  }

  const filterString = `brightness(${adj.brightness}%) contrast(${adj.contrast}%) saturate(${adj.saturate}%) blur(${adj.blur}px) grayscale(${adj.grayscale}%) sepia(${adj.sepia}%) hue-rotate(${adj.hueRotate}deg) invert(${adj.invert}%)`

  const onFile = (file: File | undefined | null) => {
    if (!file || !file.type.startsWith('video/')) {
      toast.error('Veuillez choisir un fichier vidéo')
      return
    }
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    setExportedUrl(null)
    setFileName(file.name.replace(/\.[^.]+$/, ''))
    setVideoUrl(URL.createObjectURL(file))
    setAdj(DEFAULT_ADJ)
  }

  const onLoadedMetadata = () => {
    const v = videoRef.current
    if (!v) return
    setDuration(v.duration)
    setTrimStart(0)
    setTrimEnd(v.duration)
    setDims({ w: v.videoWidth, h: v.videoHeight })
  }

  const onTimeUpdate = () => {
    const v = videoRef.current
    if (!v || exporting) return
    // Lecture en boucle sur la sélection
    if (v.currentTime >= trimEnd - 0.05 && !v.paused) {
      v.currentTime = trimStart
    }
  }

  const exportVideo = async () => {
    const v = videoRef.current
    if (!v || exporting || !videoUrl) return
    if (trimEnd - trimStart < 0.3) {
      toast.error('La sélection est trop courte (minimum 0,3 s)')
      return
    }

    setExporting(true)
    setProgress(0)
    setExportedUrl(null)

    const maxW = 1280
    const scale = Math.min(1, maxW / dims.w)
    const w = Math.round(dims.w * scale)
    const h = Math.round(dims.h * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!

    try {
      const stream = canvas.captureStream(30)

      // Piste audio (meilleur effort)
      try {
        if (!audioCtxRef.current) audioCtxRef.current = new AudioContext()
        const actx = audioCtxRef.current
        if (actx.state === 'suspended') await actx.resume()
        if (!audioNodeRef.current) audioNodeRef.current = actx.createMediaElementSource(v)
        const dest = actx.createMediaStreamDestination()
        audioNodeRef.current.connect(dest)
        audioNodeRef.current.connect(actx.destination)
        dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t))
      } catch {
        /* vidéo sans audio exploitable — on continue en muet */
      }

      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm'
      const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5_000_000 })
      const chunks: Blob[] = []
      recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data)

      const finished = new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }))
      })

      v.currentTime = trimStart
      v.playbackRate = parseFloat(speed)
      v.muted = false
      await v.play()
      recorder.start(250)

      const loop = () => {
        ctx.filter = filterString
        ctx.drawImage(v, 0, 0, w, h)
        const p = Math.min(1, (v.currentTime - trimStart) / (trimEnd - trimStart))
        setProgress(Math.round(p * 100))
        if (v.currentTime >= trimEnd - 0.03 || v.ended) {
          v.pause()
          recorder.stop()
          cancelAnimationFrame(rafRef.current ?? 0)
          return
        }
        rafRef.current = requestAnimationFrame(loop)
      }
      rafRef.current = requestAnimationFrame(loop)

      const blob = await finished
      const url = URL.createObjectURL(blob)
      setExportedUrl(url)
      toast.success('Export webm terminé')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur pendant l’export')
    } finally {
      v.playbackRate = 1
      setExporting(false)
      cancelAnimationFrame(rafRef.current ?? 0)
    }
  }

  const resetAll = () => {
    setAdj(DEFAULT_ADJ)
    setTrimStart(0)
    setTrimEnd(duration)
    setSpeed('1')
    setExportedUrl(null)
    toast.success('Réinitialisé')
  }

  const ADJ_CONTROLS: { key: keyof Adjustments; label: string; min: number; max: number; step: number; unit: string }[] = [
    { key: 'brightness', label: 'Luminosité', min: 0, max: 200, step: 1, unit: '%' },
    { key: 'contrast', label: 'Contraste', min: 0, max: 200, step: 1, unit: '%' },
    { key: 'saturate', label: 'Saturation', min: 0, max: 300, step: 1, unit: '%' },
    { key: 'blur', label: 'Flou', min: 0, max: 12, step: 0.5, unit: 'px' },
    { key: 'grayscale', label: 'Noir & blanc', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'sepia', label: 'Sépia', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'hueRotate', label: 'Teinte', min: 0, max: 360, step: 1, unit: '°' },
  ]

  return (
    <div className="flex h-full flex-col">
      {/* Barre d'outils */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 bg-card/50 px-3 py-2.5">
        <label>
          <input type="file" accept="video/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          <span className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-foreground/80 hover:bg-accent">
            <Upload className="h-3.5 w-3.5" /> Importer une vidéo
          </span>
        </label>
        {videoUrl && (
          <>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Film className="h-3.5 w-3.5" />
              {dims.w}×{dims.h} · {fmt(duration)}
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <Button size="sm" variant="outline" className="h-9 gap-1.5 border-border text-xs hover:bg-accent" onClick={resetAll}>
                <RotateCcw className="h-3.5 w-3.5" /> Réinitialiser
              </Button>
              <Button
                size="sm"
                className="h-9 gap-1.5 bg-gradient-to-r from-amber-500 to-orange-500 text-xs text-white hover:opacity-90"
                onClick={exportVideo}
                disabled={exporting}
              >
                {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clapperboard className="h-3.5 w-3.5" />}
                Exporter webm
              </Button>
            </div>
          </>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Aperçu */}
        <div className="flex min-h-[260px] flex-1 items-center justify-center overflow-auto bg-zinc-950 p-4">
          {!videoUrl ? (
            <label
              className={cn(
                'flex w-full max-w-md cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-border p-10 text-center transition-colors hover:border-amber-500/50'
              )}
            >
              <input type="file" accept="video/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 shadow-lg shadow-amber-500/25">
                <Clapperboard className="h-7 w-7 text-white" />
              </span>
              <p className="text-sm font-semibold text-foreground">Studio Vidéo</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Glissez une vidéo ou cliquez pour l’importer. Tout le montage se fait localement dans votre navigateur :
                aucune vidéo n’est envoyée sur un serveur.
              </p>
            </label>
          ) : (
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              crossOrigin="anonymous"
              onLoadedMetadata={onLoadedMetadata}
              onTimeUpdate={onTimeUpdate}
              style={{ filter: filterString, maxHeight: 'calc(100vh - 230px)' }}
              className="max-w-full rounded-lg shadow-2xl"
            />
          )}
        </div>

        {/* Panneau */}
        <div className="w-full shrink-0 overflow-y-auto border-t border-border/70 bg-card/50 lg:w-72 lg:border-l lg:border-t-0" style={{ scrollbarWidth: 'thin' }}>
          {/* Génération par IA — toujours accessible */}
          <div className="border-b border-border/70 bg-gradient-to-br from-fuchsia-500/10 to-violet-500/10 p-4">
            <div className="mb-2 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-fuchsia-400" />
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Générer par IA (moteur local)</p>
            </div>
            <Input
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="Décrivez la vidéo… (ex : un vol de drone au-dessus d'une forêt au lever du soleil)"
              className="h-9 border-border bg-muted/60 text-xs"
              aria-label="Description de la vidéo à générer"
              onKeyDown={(e) => e.key === 'Enter' && generateAI(0)}
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Select value={aiDuration} onValueChange={setAiDuration}>
                <SelectTrigger className="h-8 border-border bg-muted/50 text-xs" aria-label="Durée de la vidéo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5 secondes</SelectItem>
                  <SelectItem value="10">10 secondes</SelectItem>
                </SelectContent>
              </Select>
              <Select value={aiQuality} onValueChange={(v) => setAiQuality(v === 'quality' ? 'quality' : 'speed')}>
                <SelectTrigger className="h-8 border-border bg-muted/50 text-xs" aria-label="Qualité du rendu">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="speed">Rapide (640p)</SelectItem>
                  <SelectItem value="quality">Qualité (960p)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Button
                size="sm"
                className="h-8 flex-1 gap-1.5 bg-gradient-to-r from-fuchsia-500 to-violet-500 px-3 text-xs text-white hover:opacity-90"
                onClick={() => generateAI(0)}
                disabled={aiGenerating || aiPrompt.trim().length === 0}
              >
                {aiGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Générer
              </Button>
              {aiLastPrompt && !aiGenerating && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 border-border text-xs hover:bg-accent"
                  onClick={() => generateAI(aiVariant + 1)}
                  aria-label="Générer une autre variante"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Variante n°{aiVariant + 1}
                </Button>
              )}
            </div>
            {aiStatus && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-fuchsia-300">
                <Loader2 className="h-3 w-3 animate-spin" />
                {aiStatus}
              </p>
            )}
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground/70">
              Rendu 100 % local : thèmes montagne, océan, ville, espace, aurore, forêt,
              désert, neige, pluie… encodage MP4 par ffmpeg (quelques secondes).
            </p>
          </div>

          {videoUrl && (
            <div className="flex flex-col gap-5 p-4">
              {/* Montage */}
              <div>
                <div className="mb-2 flex items-center gap-1.5">
                  <Scissors className="h-3.5 w-3.5 text-amber-400" />
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Coupe (appliquée à l’export)</p>
                </div>
                <div className="flex flex-col gap-3">
                  <div>
                    <div className="mb-1 flex justify-between text-[10px] text-muted-foreground">
                      <span>Début</span>
                      <span className="font-mono">{fmt(trimStart)}</span>
                    </div>
                    <Slider
                      value={[trimStart]}
                      min={0}
                      max={Math.max(duration - 0.1, 0.1)}
                      step={0.1}
                      onValueChange={([v]) => {
                        const nv = Math.min(v, trimEnd - 0.3)
                        setTrimStart(nv)
                        if (videoRef.current) videoRef.current.currentTime = nv
                      }}
                      disabled={exporting}
                      aria-label="Début de la sélection"
                    />
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between text-[10px] text-muted-foreground">
                      <span>Fin</span>
                      <span className="font-mono">{fmt(trimEnd)}</span>
                    </div>
                    <Slider
                      value={[trimEnd]}
                      min={0.1}
                      max={duration || 0.1}
                      step={0.1}
                      onValueChange={([v]) => setTrimEnd(Math.max(v, trimStart + 0.3))}
                      disabled={exporting}
                      aria-label="Fin de la sélection"
                    />
                  </div>
                  <p className="rounded-lg bg-muted/60 px-3 py-2 text-center text-[11px] text-muted-foreground">
                    Durée de la sélection : <span className="font-semibold text-amber-300">{fmt(Math.max(trimEnd - trimStart, 0))}</span>
                  </p>
                </div>
              </div>

              {/* Vitesse */}
              <div>
                <div className="mb-2 flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-amber-400" />
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Vitesse</p>
                </div>
                <Select value={speed} onValueChange={setSpeed}>
                  <SelectTrigger className="h-9 border-border bg-muted/50 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['0.25', '0.5', '1', '1.5', '2', '3'].map((s) => (
                      <SelectItem key={s} value={s}>
                        {s === '1' ? 'Normale (×1)' : `×${s}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Filtres */}
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Filtres</p>
                <div className="flex flex-col gap-3">
                  {ADJ_CONTROLS.map((c) => (
                    <div key={c.key}>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-[11px] text-muted-foreground">{c.label}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">{adj[c.key]}{c.unit}</span>
                      </div>
                      <Slider
                        value={[adj[c.key]]}
                        min={c.min}
                        max={c.max}
                        step={c.step}
                        onValueChange={([v]) => setAdj((a) => ({ ...a, [c.key]: v }))}
                        disabled={exporting}
                        aria-label={c.label}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Export */}
              {exporting && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs text-amber-300">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Export en cours… ne quittez pas l’onglet
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-accent">
                    <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all" style={{ width: `${progress}%` }} />
                  </div>
                  <p className="mt-1.5 text-right font-mono text-[10px] text-amber-200">{progress}%</p>
                </div>
              )}

              {exportedUrl && !exporting && (
                <div className="flex flex-col gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
                  <p className="text-xs font-semibold text-emerald-300">Vidéo exportée</p>
                  <video src={exportedUrl} controls className="w-full rounded-lg" />
                  <a
                    href={exportedUrl}
                    download={`${fileName}-nexus.webm`}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-emerald-500 px-3 text-xs font-semibold text-white hover:bg-emerald-600"
                  >
                    <Download className="h-3.5 w-3.5" /> Télécharger le webm
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
