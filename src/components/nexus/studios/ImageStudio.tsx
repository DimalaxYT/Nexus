'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Brush,
  Crop,
  Download,
  Image as ImageIcon,
  Loader2,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  Type,
  Undo2,
  Upload,
  Wand2,
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

type Mode = 'adjust' | 'crop' | 'brush' | 'text'
interface Snapshot {
  baseSrc: string
  adj: Adjustments
  rotation: number
  flipH: boolean
  flipV: boolean
  overlay: string
}

interface Rect { x: number; y: number; w: number; h: number }

export function ImageStudio() {
  const pendingImage = useNexusStore((s) => s.pendingImage)
  const setPendingImage = useNexusStore((s) => s.setPendingImage)

  const [baseSrc, setBaseSrc] = useState<string | null>(null)
  const [adj, setAdj] = useState<Adjustments>(DEFAULT_ADJ)
  const [rotation, setRotation] = useState(0)
  const [flipH, setFlipH] = useState(false)
  const [flipV, setFlipV] = useState(false)
  const [mode, setMode] = useState<Mode>('adjust')
  const [brushColor, setBrushColor] = useState('#f43f5e')
  const [brushSize, setBrushSize] = useState(8)
  const [textValue, setTextValue] = useState('')
  const [textSize, setTextSize] = useState(48)
  const [textColor, setTextColor] = useState('#ffffff')
  const [cropRect, setCropRect] = useState<Rect | null>(null)
  const [undoStack, setUndoStack] = useState<Snapshot[]>([])
  const [aiTab, setAiTab] = useState<'generate' | 'edit'>('generate')
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiSize, setAiSize] = useState('1024x1024')
  const [aiVariant, setAiVariant] = useState(0)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const baseCanvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const cropStartRef = useRef<{ x: number; y: number } | null>(null)
  const cropSnapshotRef = useRef<string | null>(null)
  const lastPosRef = useRef<{ x: number; y: number } | null>(null)
  const textPosRef = useRef<{ x: number; y: number } | null>(null)
  const undoRef = useRef<Snapshot[]>([])

  const filterString = `brightness(${adj.brightness}%) contrast(${adj.contrast}%) saturate(${adj.saturate}%) blur(${adj.blur}px) grayscale(${adj.grayscale}%) sepia(${adj.sepia}%) hue-rotate(${adj.hueRotate}deg) invert(${adj.invert}%)`

  // Charge une image envoyée depuis le chat
  useEffect(() => {
    if (pendingImage) {
      loadImage(pendingImage)
      setPendingImage(null)
    }
     
  }, [pendingImage])

  const pushUndo = useCallback(() => {
    const overlay = overlayRef.current
    if (!baseSrc || !overlay) return
    const snap: Snapshot = {
      baseSrc,
      adj,
      rotation,
      flipH,
      flipV,
      overlay: overlay.toDataURL(),
    }
    undoRef.current = [...undoRef.current.slice(-11), snap]
    setUndoStack(undoRef.current)
  }, [baseSrc, adj, rotation, flipH, flipV])

  const undo = () => {
    const snap = undoRef.current.pop()
    if (!snap) return
    setUndoStack([...undoRef.current])
    setBaseSrc(snap.baseSrc)
    setAdj(snap.adj)
    setRotation(snap.rotation)
    setFlipH(snap.flipH)
    setFlipV(snap.flipV)
    const overlay = overlayRef.current
    if (overlay) {
      const ctx = overlay.getContext('2d')
      ctx?.clearRect(0, 0, overlay.width, overlay.height)
      const img = new Image()
      img.onload = () => ctx?.drawImage(img, 0, 0)
      img.src = snap.overlay
    }
  }

  const clearOverlay = () => {
    const overlay = overlayRef.current
    if (!overlay) return
    const ctx = overlay.getContext('2d')
    ctx?.clearRect(0, 0, overlay.width, overlay.height)
  }

  const loadImage = (src: string) => {
    pushUndo()
    setBaseSrc(src)
    setAdj(DEFAULT_ADJ)
    setRotation(0)
    setFlipH(false)
    setFlipV(false)
    setCropRect(null)
    setAiResult(null)
    requestAnimationFrame(() => clearOverlay())
    toast.success('Image chargée')
  }

  // Rendu de la base (image + filtres + rotation)
  useEffect(() => {
    const canvas = baseCanvasRef.current
    if (!canvas || !baseSrc) return
    const img = new Image()
    img.onload = () => {
      const maxDim = 1600
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const rot = ((rotation % 360) + 360) % 360
      const swap = rot === 90 || rot === 270
      const cw = swap ? h : w
      const ch = swap ? w : h
      canvas.width = cw
      canvas.height = ch
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, cw, ch)
      ctx.filter = filterString
      ctx.translate(cw / 2, ch / 2)
      ctx.rotate((rot * Math.PI) / 180)
      ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1)
      ctx.drawImage(img, -w / 2, -h / 2, w, h)
      // Adapte l'overlay en conservant son contenu
      const overlay = overlayRef.current
      if (overlay) {
        const prev = document.createElement('canvas')
        prev.width = overlay.width || cw
        prev.height = overlay.height || ch
        const pctx = prev.getContext('2d')
        if (overlay.width > 0) pctx?.drawImage(overlay, 0, 0)
        overlay.width = cw
        overlay.height = ch
        if (overlay.width > 0 && prev.width > 0) {
          overlay.getContext('2d')?.drawImage(prev, 0, 0, cw, ch)
        }
      }
    }
    img.src = baseSrc
  }, [baseSrc, filterString, rotation, flipH, flipV])

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const overlay = overlayRef.current!
    const rect = overlay.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) * overlay.width) / rect.width,
      y: ((e.clientY - rect.top) * overlay.height) / rect.height,
    }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!baseSrc) return
    const pos = getPos(e)
    if (mode === 'brush') {
      pushUndo()
      drawingRef.current = true
      lastPosRef.current = pos
    } else if (mode === 'crop') {
      cropStartRef.current = pos
      const overlay = overlayRef.current
      if (overlay) cropSnapshotRef.current = overlay.toDataURL()
      setCropRect({ x: pos.x, y: pos.y, w: 0, h: 0 })
    } else if (mode === 'text') {
      textPosRef.current = pos
      toast.info('Position choisie — saisissez le texte puis cliquez « Ajouter le texte »')
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const overlay = overlayRef.current
    if (!overlay || !baseSrc) return
    const pos = getPos(e)
    if (drawingRef.current && mode === 'brush') {
      const ctx = overlay.getContext('2d')
      if (!ctx || !lastPosRef.current) return
      ctx.strokeStyle = brushColor
      ctx.lineWidth = brushSize
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y)
      ctx.lineTo(pos.x, pos.y)
      ctx.stroke()
      lastPosRef.current = pos
    } else if (cropStartRef.current && mode === 'crop') {
      const start = cropStartRef.current
      const ctx = overlay.getContext('2d')
      if (!ctx) return
      const snap = cropSnapshotRef.current
      if (snap) {
        const img = new Image()
        // Redessine l'aperçu du rectangle en continu
        ctx.clearRect(0, 0, overlay.width, overlay.height)
        ctx.drawImage(img, 0, 0)
        img.onload = () => {
          ctx.clearRect(0, 0, overlay.width, overlay.height)
          ctx.drawImage(img, 0, 0)
          drawCropPreview(ctx, start, pos)
        }
        img.src = snap
      }
      drawCropPreview(ctx, start, pos)
      setCropRect({
        x: Math.min(start.x, pos.x),
        y: Math.min(start.y, pos.y),
        w: Math.abs(pos.x - start.x),
        h: Math.abs(pos.y - start.y),
      })
    }
  }

  const drawCropPreview = (
    ctx: CanvasRenderingContext2D,
    start: { x: number; y: number },
    pos: { x: number; y: number }
  ) => {
    ctx.save()
    ctx.strokeStyle = '#a855f7'
    ctx.lineWidth = 2
    ctx.setLineDash([8, 5])
    ctx.strokeRect(start.x, start.y, pos.x - start.x, pos.y - start.y)
    ctx.restore()
  }

  const onPointerUp = () => {
    drawingRef.current = false
    lastPosRef.current = null
    cropStartRef.current = null
  }

  const applyCrop = () => {
    const base = baseCanvasRef.current
    const overlay = overlayRef.current
    if (!base || !overlay || !cropRect || cropRect.w < 10 || cropRect.h < 10) {
      toast.error('Tracez d’abord une zone de recadrage sur l’image')
      return
    }
    pushUndo()
    const out = document.createElement('canvas')
    out.width = Math.round(cropRect.w)
    out.height = Math.round(cropRect.h)
    const ctx = out.getContext('2d')!
    ctx.drawImage(base, cropRect.x, cropRect.y, cropRect.w, cropRect.h, 0, 0, cropRect.w, cropRect.h)
    ctx.drawImage(overlay, cropRect.x, cropRect.y, cropRect.w, cropRect.h, 0, 0, cropRect.w, cropRect.h)
    setBaseSrc(out.toDataURL('image/png'))
    setAdj(DEFAULT_ADJ)
    setRotation(0)
    setFlipH(false)
    setFlipV(false)
    setCropRect(null)
    requestAnimationFrame(() => clearOverlay())
    toast.success('Image recadrée')
  }

  const addText = () => {
    const overlay = overlayRef.current
    const pos = textPosRef.current
    if (!overlay || !pos || !textValue.trim()) {
      toast.error('Choisissez une position sur l’image et saisissez un texte')
      return
    }
    pushUndo()
    const ctx = overlay.getContext('2d')!
    ctx.font = `700 ${textSize}px 'Geist', sans-serif`
    ctx.fillStyle = textColor
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(0,0,0,0.5)'
    ctx.shadowBlur = 6
    ctx.fillText(textValue, pos.x, pos.y)
    setTextValue('')
    toast.success('Texte ajouté')
  }

  const flattenAndDownload = () => {
    const base = baseCanvasRef.current
    const overlay = overlayRef.current
    if (!base) return
    const out = document.createElement('canvas')
    out.width = base.width
    out.height = base.height
    const ctx = out.getContext('2d')!
    ctx.drawImage(base, 0, 0)
    if (overlay) ctx.drawImage(overlay, 0, 0)
    const url = out.toDataURL('image/png')
    const a = document.createElement('a')
    a.href = url
    a.download = 'nexus-image.png'
    a.click()
    toast.success('Image exportée en PNG')
  }

  const onFile = (file: File | undefined | null) => {
    if (!file || !file.type.startsWith('image/')) {
      toast.error('Veuillez choisir un fichier image')
      return
    }
    const reader = new FileReader()
    reader.onload = () => loadImage(String(reader.result))
    reader.readAsDataURL(file)
  }

  const runAI = async (variantOverride?: number) => {
    const prompt = aiPrompt.trim()
    if (!prompt || aiLoading) return
    const variant = variantOverride ?? aiVariant
    setAiLoading(true)
    setAiResult(null)
    try {
      const isEdit = aiTab === 'edit'
      if (isEdit && !baseSrc) {
        toast.error('Importez d’abord une image à retoucher')
        return
      }
      const res = await fetch(isEdit ? '/api/tools/image-edit' : '/api/tools/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEdit ? { prompt, image: baseSrc } : { prompt, size: aiSize, variant }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur IA')
      setAiResult(data.dataUrl)
      if (!isEdit) setAiVariant(variant)
      toast.success(isEdit ? 'Retouche IA terminée' : variant > 0 ? `Image générée — variante ${variant}` : 'Image générée')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur IA')
    } finally {
      setAiLoading(false)
    }
  }

  const useAiResult = () => {
    if (aiResult) loadImage(aiResult)
  }

  const ADJ_CONTROLS: { key: keyof Adjustments; label: string; min: number; max: number; step: number; unit: string }[] = [
    { key: 'brightness', label: 'Luminosité', min: 0, max: 200, step: 1, unit: '%' },
    { key: 'contrast', label: 'Contraste', min: 0, max: 200, step: 1, unit: '%' },
    { key: 'saturate', label: 'Saturation', min: 0, max: 300, step: 1, unit: '%' },
    { key: 'blur', label: 'Flou', min: 0, max: 20, step: 0.5, unit: 'px' },
    { key: 'grayscale', label: 'Noir & blanc', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'sepia', label: 'Sépia', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'hueRotate', label: 'Teinte', min: 0, max: 360, step: 1, unit: '°' },
    { key: 'invert', label: 'Inverser', min: 0, max: 100, step: 1, unit: '%' },
  ]

  return (
    <div className="flex h-full flex-col">
      {/* Barre d'outils */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 bg-card/50 px-3 py-2.5">
        <label>
          <input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          <span className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-foreground/80 hover:bg-accent">
            <Upload className="h-3.5 w-3.5" /> Importer
          </span>
        </label>
        {(
          [
            { id: 'adjust', label: 'Ajuster', icon: SlidersHorizontal },
            { id: 'crop', label: 'Recadrer', icon: Crop },
            { id: 'brush', label: 'Dessiner', icon: Brush },
            { id: 'text', label: 'Texte', icon: Type },
          ] as { id: Mode; label: string; icon: typeof Crop }[]
        ).map((m) => (
          <Button
            key={m.id}
            size="sm"
            variant={mode === m.id ? 'default' : 'outline'}
            disabled={!baseSrc}
            className={cn(
              'h-9 gap-1.5 px-3 text-xs',
              mode === m.id ? 'bg-violet-500 text-white hover:bg-violet-600' : 'border-border hover:bg-accent'
            )}
            onClick={() => setMode(m.id)}
          >
            <m.icon className="h-3.5 w-3.5" />
            {m.label}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="outline" className="h-9 border-border hover:bg-accent" onClick={() => setRotation((r) => (r + 270) % 360)} aria-label="Pivoter à gauche">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="outline" className="h-9 border-border hover:bg-accent" onClick={() => setRotation((r) => (r + 90) % 360)} aria-label="Pivoter à droite">
            <RotateCw className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="outline" className="h-9 border-border text-xs hover:bg-accent" onClick={() => setFlipH((v) => !v)}>
            Miroir ↔
          </Button>
          <Button size="sm" variant="outline" className="h-9 gap-1.5 border-border text-xs hover:bg-accent" onClick={undo} disabled={undoRef.current.length === 0}>
            <Undo2 className="h-3.5 w-3.5" /> Annuler
          </Button>
          <Button size="sm" className="h-9 gap-1.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-xs text-white hover:opacity-90" onClick={flattenAndDownload} disabled={!baseSrc}>
            <Download className="h-3.5 w-3.5" /> Exporter PNG
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Zone canvas */}
        <div
          className={cn(
            'relative flex min-h-[300px] flex-1 items-center justify-center overflow-auto bg-[repeating-conic-gradient(#111113_0%_25%,#18181b_0%_50%)] bg-[length:24px_24px] p-4',
            dragOver && 'ring-2 ring-inset ring-violet-500'
          )}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            onFile(e.dataTransfer.files?.[0])
          }}
        >
          {!baseSrc ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 shadow-lg shadow-emerald-500/25">
                <ImageIcon className="h-7 w-7 text-white" />
              </span>
              <p className="text-sm font-semibold text-foreground">Studio Image</p>
              <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
                Glissez-déposez une image ici, importez un fichier, ou générez-en une par IA depuis le panneau de droite.
              </p>
              <label>
                <input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
                <span className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-emerald-500 px-4 text-sm font-semibold text-white hover:bg-emerald-600">
                  <Upload className="h-4 w-4" /> Importer une image
                </span>
              </label>
            </div>
          ) : (
            <div className="relative">
              <canvas ref={baseCanvasRef} className="max-h-full max-w-full rounded-lg shadow-2xl" style={{ maxHeight: 'calc(100vh - 220px)', maxWidth: '100%' }} />
              <canvas
                ref={overlayRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
                className={cn(
                  'absolute left-0 top-0 h-full w-full rounded-lg',
                  mode === 'brush' && 'cursor-crosshair',
                  mode === 'crop' && 'cursor-crosshair',
                  mode === 'text' && 'cursor-text'
                )}
              />
            </div>
          )}
        </div>

        {/* Panneau latéral */}
        <div className="w-full shrink-0 overflow-y-auto border-t border-border/70 bg-card/50 lg:w-72 lg:border-l lg:border-t-0" style={{ scrollbarWidth: 'thin' }}>
          {/* Outils contextuels */}
          {mode === 'brush' && (
            <div className="flex flex-col gap-3 border-b border-border/70 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Pinceau</p>
              <div className="flex items-center gap-2">
                <input type="color" value={brushColor} onChange={(e) => setBrushColor(e.target.value)} className="h-9 w-12 cursor-pointer rounded-lg border border-border bg-muted/50 p-1" aria-label="Couleur du pinceau" />
                <div className="flex-1">
                  <p className="mb-1 text-[10px] text-muted-foreground">Taille : {brushSize}px</p>
                  <Slider value={[brushSize]} min={1} max={60} step={1} onValueChange={([v]) => setBrushSize(v)} aria-label="Taille du pinceau" />
                </div>
              </div>
            </div>
          )}
          {mode === 'text' && (
            <div className="flex flex-col gap-3 border-b border-border/70 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Ajouter du texte</p>
              <Input value={textValue} onChange={(e) => setTextValue(e.target.value)} placeholder="Votre texte…" className="h-9 border-border bg-muted/50 text-sm" />
              <div className="flex items-center gap-2">
                <input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} className="h-9 w-12 cursor-pointer rounded-lg border border-border bg-muted/50 p-1" aria-label="Couleur du texte" />
                <div className="flex-1">
                  <p className="mb-1 text-[10px] text-muted-foreground">Taille : {textSize}px</p>
                  <Slider value={[textSize]} min={12} max={160} step={2} onValueChange={([v]) => setTextSize(v)} aria-label="Taille du texte" />
                </div>
              </div>
              <Button size="sm" className="h-9 bg-violet-500 text-xs text-white hover:bg-violet-600" onClick={addText}>
                Ajouter le texte
              </Button>
            </div>
          )}
          {mode === 'crop' && cropRect && cropRect.w > 10 && (
            <div className="border-b border-border/70 p-4">
              <Button size="sm" className="h-9 w-full gap-1.5 bg-violet-500 text-xs text-white hover:bg-violet-600" onClick={applyCrop}>
                <Crop className="h-3.5 w-3.5" /> Appliquer le recadrage
              </Button>
            </div>
          )}

          {/* Ajustements */}
          <div className={cn('border-b border-border/70 p-4', mode !== 'adjust' && 'opacity-50')}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Réglages</p>
              <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px] text-muted-foreground" onClick={() => setAdj(DEFAULT_ADJ)} disabled={!baseSrc}>
                <RotateCcw className="h-3 w-3" /> Réinitialiser
              </Button>
            </div>
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
                    disabled={!baseSrc || mode !== 'adjust'}
                    aria-label={c.label}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* IA */}
          <div className="p-4">
            <div className="mb-3 flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-violet-400" />
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Intelligence artificielle</p>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-muted/60 p-1">
              {(
                [
                  { id: 'generate', label: 'Générer' },
                  { id: 'edit', label: 'Retoucher IA' },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setAiTab(t.id)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                    aiTab === t.id ? 'bg-violet-500 text-white' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {aiTab === 'generate' && (
              <div className="mb-3">
                <p className="mb-1.5 text-[10px] text-muted-foreground">Format</p>
                <Select value={aiSize} onValueChange={setAiSize}>
                  <SelectTrigger className="h-9 border-border bg-muted/50 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1024x1024">Carré — 1024×1024</SelectItem>
                    <SelectItem value="1344x768">Paysage — 1344×768</SelectItem>
                    <SelectItem value="768x1344">Portrait — 768×1344</SelectItem>
                    <SelectItem value="1440x720">Bannière — 1440×720</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              rows={3}
              placeholder={aiTab === 'generate' ? 'Décrivez l’image à créer… (ex : un renard dans une forêt enchantée, style aquarelle)' : 'Décrivez la retouche… (ex : transforme le fond en plage tropicale au sunset)'}
              className="mb-3 w-full resize-none rounded-lg border border-border bg-muted/50 p-3 text-xs text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50"
            />
            <Button
              size="sm"
              className="h-9 w-full gap-1.5 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-xs text-white hover:opacity-90"
              onClick={() => runAI(0)}
              disabled={aiLoading || aiPrompt.trim().length === 0}
            >
              {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              {aiTab === 'generate' ? 'Générer l’image' : 'Retoucher avec l’IA'}
            </Button>
            {aiTab === 'generate' && aiVariant > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="mt-2 h-8 w-full gap-1.5 border-border text-xs hover:bg-accent"
                onClick={() => runAI(aiVariant + 1)}
                disabled={aiLoading || aiPrompt.trim().length === 0}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Générer une autre variante (n°{aiVariant + 1})
              </Button>
            )}
            {aiLoading && (
              <p className="mt-3 flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> L’IA travaille, cela peut prendre ~20 s…
              </p>
            )}
            {aiResult && (
              <div className="mt-4 flex flex-col gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
                <img src={aiResult} alt="Résultat IA" className="w-full rounded-lg" />
                <div className="flex gap-2">
                  <Button size="sm" className="h-8 flex-1 gap-1.5 bg-emerald-500 text-xs text-white hover:bg-emerald-600" onClick={useAiResult}>
                    <ImageIcon className="h-3.5 w-3.5" /> Utiliser
                  </Button>
                  <a
                    href={aiResult}
                    download="nexus-ia.png"
                    className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-secondary px-3 text-xs font-medium text-secondary-foreground hover:bg-secondary/80"
                  >
                    <Download className="h-3.5 w-3.5" /> Télécharger
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
