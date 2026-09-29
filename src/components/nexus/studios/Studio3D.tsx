'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Edges, Grid, Line, OrbitControls, TransformControls } from '@react-three/drei'
import * as THREE from 'three'
import {
  Circle,
  Copy,
  Diamond,
  Download,
  Eraser,
  Eye,
  EyeOff,
  Film,
  Focus,
  Hexagon,
  Lightbulb,
  Loader2,
  Lock,
  LockOpen,
  Pause,
  Pill,
  Play,
  Plus,
  RectangleHorizontal,
  Ruler,
  Save,
  Sparkles,
  Square,
  Torus,
  Triangle,
  Trash2,
  Undo2,
  Redo2,
  Upload,
  Video,
  Wand2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { uid, useNexusStore } from '@/lib/store'
import {
  PRIMITIVE_LABELS,
  PRIMITIVE_TYPES,
  type LightingPreset,
  type PrimitiveType,
  type SceneKeyframe,
  type SceneObject,
  type SceneSpec,
} from '@/lib/nexus-types'
import { MATERIAL_PRESETS, LIGHTING_PRESETS, SCENE_TEMPLATES } from '@/lib/scene-presets'
import { applyAnimation } from '@/lib/scene-animation'
import { sanitizeScene } from '@/lib/scene-utils'
import { cn } from '@/lib/utils'

const DEFAULT_SCENE: SceneSpec = {
  name: 'Nouvelle scène',
  background: '#09090b',
  ground: true,
  groundColor: '#18181b',
  objects: [],
  lighting: 'studio',
  animationDuration: 6,
}

const PALETTE = ['#a855f7', '#ec4899', '#10b981', '#f59e0b', '#f43f5e', '#14b8a6', '#e2e8f0', '#84cc16']

const ADD_ICONS: Record<PrimitiveType, typeof Square> = {
  box: Square,
  sphere: Circle,
  cylinder: RectangleHorizontal,
  cone: Triangle,
  torus: Torus,
  plane: RectangleHorizontal,
  capsule: Pill as typeof Square,
  dodecahedron: Hexagon,
  icosahedron: Diamond,
  tetrahedron: Triangle,
  torusKnot: Loader2 as typeof Square,
  ring: Circle,
  octahedron: Diamond,
}

const CURVED_TYPES: PrimitiveType[] = ['sphere', 'cylinder', 'cone', 'torus', 'capsule', 'torusKnot', 'plane', 'ring']
const DETAIL_TYPES: PrimitiveType[] = ['icosahedron', 'dodecahedron', 'octahedron', 'tetrahedron']

const CAMERA_VIEWS: { id: string; label: string; pos: [number, number, number]; target: [number, number, number] }[] = [
  { id: 'iso', label: 'Iso', pos: [9, 7, 9], target: [0, 1, 0] },
  { id: 'front', label: 'Face', pos: [0, 2.5, 12], target: [0, 1, 0] },
  { id: 'top', label: 'Dessus', pos: [0, 17, 0.01], target: [0, 0, 0] },
  { id: 'side', label: 'Côté', pos: [12, 3.5, 0], target: [0, 1, 0] },
]

type Vec3 = [number, number, number]

function Geometry({ type, segments = 32 }: { type: PrimitiveType; segments?: number }) {
  const s = Math.max(6, Math.min(64, Math.round(segments)))
  const detail = s >= 48 ? 2 : s >= 24 ? 1 : 0
  switch (type) {
    case 'box':
      return <boxGeometry args={[1, 1, 1]} />
    case 'sphere':
      return <sphereGeometry args={[0.5, s, s]} />
    case 'cylinder':
      return <cylinderGeometry args={[0.5, 0.5, 1, s]} />
    case 'cone':
      return <coneGeometry args={[0.5, 1, s]} />
    case 'torus':
      return <torusGeometry args={[0.5, 0.18, Math.max(8, Math.round(s / 2)), Math.max(24, Math.round(s * 1.5))]} />
    case 'plane':
      return <planeGeometry args={[1, 1, Math.max(1, Math.round(s / 8)), Math.max(1, Math.round(s / 8))]} />
    case 'capsule':
      return <capsuleGeometry args={[0.32, 0.6, Math.max(4, Math.round(s / 4)), Math.max(8, Math.round(s / 2))]} />
    case 'dodecahedron':
      return <dodecahedronGeometry args={[0.6, detail]} />
    case 'icosahedron':
      return <icosahedronGeometry args={[0.6, detail]} />
    case 'tetrahedron':
      return <tetrahedronGeometry args={[0.7, detail]} />
    case 'torusKnot':
      return <torusKnotGeometry args={[0.4, 0.14, Math.max(48, s * 3), Math.max(8, Math.round(s / 2))]} />
    case 'ring':
      return <ringGeometry args={[0.25, 0.5, Math.max(8, s), 1]} />
    case 'octahedron':
      return <octahedronGeometry args={[0.6, detail]} />
    default:
      return <boxGeometry args={[1, 1, 1]} />
  }
}

function GlBridge({ onReady }: { onReady: (gl: THREE.WebGLRenderer) => void }) {
  const gl = useThree((s) => s.gl)
  useEffect(() => onReady(gl), [gl, onReady])
  return null
}

/** Vues caméra animées (isométrique, face, dessus, côté, recadrer). */
function CameraRig({
  request,
}: {
  request: { pos: Vec3; target: Vec3; nonce: number } | null
}) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as
    | { target: THREE.Vector3; update: () => void }
    | null
  const anim = useRef<{
    from: THREE.Vector3
    to: THREE.Vector3
    tFrom: THREE.Vector3
    tTo: THREE.Vector3
    t: number
  } | null>(null)

  useEffect(() => {
    if (!request || !controls) return
    anim.current = {
      from: camera.position.clone(),
      to: new THREE.Vector3(...request.pos),
      tFrom: controls.target.clone(),
      tTo: new THREE.Vector3(...request.target),
      t: 0,
    }
  }, [request, camera, controls])

  useFrame((_, dt) => {
    const a = anim.current
    if (!a || !controls) return
    a.t = Math.min(1, a.t + dt * 1.9)
    const e = 1 - Math.pow(1 - a.t, 3)
    camera.position.lerpVectors(a.from, a.to, e)
    controls.target.lerpVectors(a.tFrom, a.tTo, e)
    controls.update()
    if (a.t >= 1) anim.current = null
  })
  return null
}

/** Ligne de mesure entre deux points cliqués + sphères d'extrémité. */
function MeasureLine({ a, b }: { a: Vec3; b: Vec3 | null }) {
  if (!b) {
    return (
      <>
        <mesh position={a}>
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshBasicMaterial color="#facc15" />
        </mesh>
      </>
    )
  }
  const dist = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  return (
    <>
      <Line points={[a, b]} color="#facc15" lineWidth={2} dashed dashSize={0.18} gapSize={0.12} />
      <mesh position={a}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshBasicMaterial color="#facc15" />
      </mesh>
      <mesh position={b}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshBasicMaterial color="#facc15" />
      </mesh>
      <group position={[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.35, (a[2] + b[2]) / 2]}>
        <Billboard text={`${dist.toFixed(2)} m`} />
      </group>
    </>
  )
}

/** Petite étiquette texte toujours face à la caméra (sans dépendance Html). */
function Billboard({ text }: { text: string }) {
  const { camera } = useThree()
  const ref = useRef<THREE.Group>(null)
  useFrame(() => {
    if (ref.current) ref.current.quaternion.copy(camera.quaternion)
  })
  return (
    <group ref={ref}>
      <mesh>
        <planeGeometry args={[text.length * 0.09 + 0.18, 0.3]} />
        <meshBasicMaterial color="#09090b" transparent opacity={0.82} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0, 0.002]}>
        <planeGeometry args={[text.length * 0.09 + 0.18, 0.3]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  )
}

/** Lecteur d'animation : interpole les clés de chaque objet en temps réel. */
function AnimationPlayer({
  scene,
  meshes,
  playingRef,
  timeRef,
  duration,
  onTime,
}: {
  scene: SceneSpec
  meshes: Map<string, THREE.Mesh>
  playingRef: React.MutableRefObject<boolean>
  timeRef: React.MutableRefObject<number>
  duration: number
  onTime: (t: number) => void
}) {
  const lastReported = useRef(-1)
  useFrame((_, dt) => {
    if (!playingRef.current) return
    timeRef.current = (timeRef.current + dt / Math.max(0.5, duration)) % 1
    applyAnimation(scene.objects, meshes, timeRef.current)
    const bucket = Math.floor(timeRef.current * 24)
    if (bucket !== lastReported.current) {
      lastReported.current = bucket
      onTime(timeRef.current)
    }
  })
  return null
}

interface SceneMeshProps {
  obj: SceneObject
  selected: boolean
  gizmoMode: 'translate' | 'rotate' | 'scale'
  snap: number | null
  interactive: boolean
  onSelect: (id: string) => void
  onTransform: (id: string, t: { position: Vec3; rotation: Vec3; scale: Vec3 }) => void
  onTransformStart: () => void
  onTransformEnd: () => void
  registerRef: (id: string, mesh: THREE.Mesh) => void
  onMeasure: (point: Vec3) => void
  measureMode: boolean
}

function SceneMesh({
  obj,
  selected,
  gizmoMode,
  snap,
  interactive,
  onSelect,
  onTransform,
  onTransformStart,
  onTransformEnd,
  registerRef,
  onMeasure,
  measureMode,
}: SceneMeshProps) {
  const [mesh, setMesh] = useState<THREE.Mesh | null>(null)
  useEffect(() => {
    if (mesh) registerRef(obj.id, mesh)
  }, [mesh, obj.id, registerRef])

  const commit = () => {
    if (!mesh) return
    onTransform(obj.id, {
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
      scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z],
    })
  }

  if (obj.visible === false) return null

  return (
    <>
      <mesh
        ref={setMesh}
        position={obj.position}
        rotation={obj.rotation}
        scale={obj.scale}
        castShadow
        receiveShadow
        onPointerDown={(e) => {
          e.stopPropagation()
          if (measureMode) {
            onMeasure([e.point.x, e.point.y, e.point.z])
            return
          }
          if (obj.locked) return
          onSelect(obj.id)
        }}
      >
        <Geometry type={obj.type} segments={obj.segments} />
        <meshStandardMaterial
          color={obj.color}
          metalness={obj.metalness}
          roughness={obj.roughness}
          transparent={obj.opacity < 1}
          opacity={obj.opacity}
          emissive={obj.emissive}
          emissiveIntensity={obj.emissiveIntensity}
          side={THREE.DoubleSide}
        />
        {selected && !obj.locked && <Edges lineWidth={2} color="#a855f7" />}
        {obj.locked && <Edges lineWidth={1} color="#71717a" />}
      </mesh>
      {selected && mesh && !obj.locked && interactive && (
        <TransformControls
          object={mesh}
          mode={gizmoMode}
          onObjectChange={commit}
          onMouseDown={onTransformStart}
          onMouseUp={onTransformEnd}
          size={0.8}
          {...(snap !== null ? { translationSnap: snap } : {})}
        />
      )}
    </>
  )
}

export function Studio3D() {
  const pendingScene = useNexusStore((s) => s.pendingScene)
  const setPendingScene = useNexusStore((s) => s.setPendingScene)

  const [scene, setScene] = useState<SceneSpec>(DEFAULT_SCENE)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [gizmoMode, setGizmoMode] = useState<'translate' | 'rotate' | 'scale'>('translate')
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [savedScenes, setSavedScenes] = useState<{ name: string; date: string; spec: SceneSpec }[]>([])

  // Annuler / refaire (historique de la scène)
  const [past, setPast] = useState<SceneSpec[]>([])
  const [future, setFuture] = useState<SceneSpec[]>([])

  // Grille ajustable + aimantation
  const [gridCell, setGridCell] = useState('1')
  const [gridVisible, setGridVisible] = useState(true)
  const [snapEnabled, setSnapEnabled] = useState(false)

  // Outil de mesure
  const [measureMode, setMeasureMode] = useState(false)
  const [measureA, setMeasureA] = useState<Vec3 | null>(null)
  const [measureB, setMeasureB] = useState<Vec3 | null>(null)

  // Vues caméra animées
  const [cameraRequest, setCameraRequest] = useState<{ pos: Vec3; target: Vec3; nonce: number } | null>(null)

  // Animation clé par clé
  const [animOpen, setAnimOpen] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [animTime, setAnimTime] = useState(0)
  const playingRef = useRef(false)
  const timeRef = useRef(0)

  const glRef = useRef<THREE.WebGLRenderer | null>(null)
  const meshRefs = useRef<Map<string, THREE.Mesh>>(new Map())
  const dragBeforeRef = useRef<SceneSpec | null>(null)
  const importRef = useRef<HTMLInputElement>(null)

  const registerRef = useCallback((id: string, mesh: THREE.Mesh) => {
    meshRefs.current.set(id, mesh)
  }, [])

  useEffect(() => {
    try {
      const raw = localStorage.getItem('nexus-saved-scenes')
      if (raw) setSavedScenes(JSON.parse(raw))
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (pendingScene) {
      setPast((p) => [...p.slice(-49), scene])
      setFuture([])
      setScene(pendingScene)
      setSelectedId(null)
      setPendingScene(null)
      toast.success(`Scène « ${pendingScene.name} » chargée dans le studio`)
      // Scène générée avec des animations intégrées → lecture automatique
      if (pendingScene.objects.some((o) => (o.keyframes?.length ?? 0) > 1)) {
        timeRef.current = 0
        setAnimTime(0)
        playingRef.current = true
        setPlaying(true)
      }
    }
  }, [pendingScene, setPendingScene, scene])

  // Raccourcis clavier : Ctrl+Z / Ctrl+Maj+Z (ou Ctrl+Y)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault()
        undoRef.current()
      } else if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')) {
        e.preventDefault()
        redoRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const selected = scene.objects.find((o) => o.id === selectedId) ?? null
  const lighting = LIGHTING_PRESETS[scene.lighting ?? 'studio']

  /** Pousse l'état actuel dans l'historique avant une modification structurelle. */
  const snapshot = useCallback((s: SceneSpec) => {
    setPast((p) => [...p.slice(-49), s])
    setFuture([])
  }, [])

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p
      const prev = p[p.length - 1]
      setScene((current) => {
        setFuture((f) => [current, ...f.slice(0, 49)])
        return prev
      })
      return p.slice(0, -1)
    })
    setSelectedId(null)
  }, [])

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f
      const next = f[0]
      setScene((current) => {
        setPast((p) => [...p.slice(-49), current])
        return next
      })
      return f.slice(1)
    })
    setSelectedId(null)
  }, [])

  // refs stables pour les raccourcis clavier
  const undoRef = useRef(undo)
  const redoRef = useRef(redo)
  useEffect(() => {
    undoRef.current = undo
    redoRef.current = redo
  }, [undo, redo])

  const patchObject = useCallback((id: string, patch: Partial<SceneObject>) => {
    setScene((s) => ({ ...s, objects: s.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) }))
  }, [])

  const onTransform = useCallback(
    (id: string, t: { position: Vec3; rotation: Vec3; scale: Vec3 }) => {
      patchObject(id, t)
    },
    [patchObject]
  )

  const onTransformStart = useCallback(() => {
    dragBeforeRef.current = scene
  }, [scene])

  const onTransformEnd = useCallback(() => {
    if (dragBeforeRef.current && dragBeforeRef.current !== scene) {
      snapshot(dragBeforeRef.current)
      dragBeforeRef.current = null
    }
  }, [scene, snapshot])

  const addObject = (type: PrimitiveType) => {
    snapshot(scene)
    const obj: SceneObject = {
      id: uid(),
      name: `${PRIMITIVE_LABELS[type]} ${scene.objects.length + 1}`,
      type,
      position: [0, 0.5, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      color: PALETTE[scene.objects.length % PALETTE.length],
      metalness: 0.2,
      roughness: 0.5,
      opacity: 1,
      emissive: '#000000',
      emissiveIntensity: 0,
      visible: true,
      locked: false,
      segments: 32,
    }
    setScene((s) => ({ ...s, objects: [...s.objects, obj] }))
    setSelectedId(obj.id)
  }

  const deleteSelected = () => {
    if (!selectedId) return
    snapshot(scene)
    setScene((s) => ({ ...s, objects: s.objects.filter((o) => o.id !== selectedId) }))
    setSelectedId(null)
  }

  const duplicateSelected = () => {
    if (!selected) return
    snapshot(scene)
    const copy: SceneObject = {
      ...selected,
      id: uid(),
      name: `${selected.name} (copie)`,
      keyframes: [],
      position: [selected.position[0] + 0.7, selected.position[1], selected.position[2] + 0.7],
    }
    setScene((s) => ({ ...s, objects: [...s.objects, copy] }))
    setSelectedId(copy.id)
  }

  const onMeasureClick = (point: Vec3) => {
    if (!measureA || (measureA && measureB)) {
      setMeasureA(point)
      setMeasureB(null)
    } else {
      setMeasureB(point)
    }
  }

  const clearMeasure = () => {
    setMeasureA(null)
    setMeasureB(null)
  }

  const screenshot = () => {
    const gl = glRef.current
    if (!gl) return
    try {
      const url = gl.domElement.toDataURL('image/png')
      const a = document.createElement('a')
      a.href = url
      a.download = 'nexus-3d.png'
      a.click()
      toast.success('Capture 3D téléchargée')
    } catch {
      toast.error('Capture impossible')
    }
  }

  const saveScene = () => {
    const entry = { name: scene.name, date: new Date().toLocaleDateString('fr-FR'), spec: scene }
    const next = [entry, ...savedScenes.filter((s) => s.name !== scene.name)].slice(0, 12)
    setSavedScenes(next)
    localStorage.setItem('nexus-saved-scenes', JSON.stringify(next))
    toast.success(`Scène « ${scene.name} » sauvegardée`)
  }

  const loadSaved = (name: string) => {
    const found = savedScenes.find((s) => s.name === name)
    if (!found) return
    snapshot(scene)
    setScene(found.spec)
    setSelectedId(null)
    toast.success(`Scène « ${name} » chargée`)
  }

  const loadTemplate = (id: string) => {
    const tpl = SCENE_TEMPLATES.find((t) => t.id === id)
    if (!tpl) return
    snapshot(scene)
    const spec = tpl.build()
    setScene(spec)
    setSelectedId(null)
    toast.success(`Template « ${tpl.name} » chargé (${spec.objects.length} objets)`)
  }

  const applyLighting = (preset: LightingPreset) => {
    snapshot(scene)
    const cfg = LIGHTING_PRESETS[preset]
    setScene((s) => ({ ...s, lighting: preset, background: cfg.background, groundColor: cfg.groundColor }))
    toast.success(`Environnement « ${cfg.label} » appliqué`)
  }

  const generateAI = async () => {
    const brief = aiPrompt.trim()
    if (!brief || aiLoading) return
    setAiLoading(true)
    try {
      const res = await fetch('/api/tools/scene', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Génération impossible')
      snapshot(scene)
      setScene(data.scene as SceneSpec)
      setSelectedId(null)
      setAiPrompt('')
      toast.success(`Scène « ${(data.scene as SceneSpec).name} » générée (${data.scene.objects.length} objets)`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur de génération')
    } finally {
      setAiLoading(false)
    }
  }

  // ── Animation clé par clé ──────────────────────────────────────────────────

  const addKeyframe = () => {
    if (!selected) return
    snapshot(scene)
    const kf: SceneKeyframe = {
      t: Math.round(animTime * 100) / 100,
      position: [...selected.position] as Vec3,
      rotation: [...selected.rotation] as Vec3,
      scale: [...selected.scale] as Vec3,
    }
    const rest = (selected.keyframes ?? []).filter((k) => Math.abs(k.t - kf.t) > 0.01)
    patchObject(selected.id, { keyframes: [...rest, kf].sort((a, b) => a.t - b.t) })
    toast.success(`Clé ajoutée à ${(kf.t * 100).toFixed(0)} % pour « ${selected.name} »`)
  }

  const deleteKeyframe = (t: number) => {
    if (!selected) return
    snapshot(scene)
    patchObject(selected.id, { keyframes: (selected.keyframes ?? []).filter((k) => k.t !== t) })
  }

  const scrubTo = (t: number) => {
    const clamped = Math.max(0, Math.min(1, t))
    setAnimTime(clamped)
    timeRef.current = clamped
    if (!playingRef.current) applyAnimation(scene.objects, meshRefs.current, clamped)
  }

  const playAnim = () => {
    timeRef.current = animTime >= 0.999 ? 0 : animTime
    playingRef.current = true
    setPlaying(true)
  }

  const pauseAnim = () => {
    playingRef.current = false
    setPlaying(false)
  }

  const stopAnim = () => {
    playingRef.current = false
    setPlaying(false)
    timeRef.current = 0
    setAnimTime(0)
    // restaure les poses d'origine depuis l'état React
    for (const o of scene.objects) {
      const mesh = meshRefs.current.get(o.id)
      if (!mesh) continue
      mesh.position.set(...o.position)
      mesh.rotation.set(...o.rotation)
      mesh.scale.set(...o.scale)
    }
  }

  // ── Export / import ────────────────────────────────────────────────────────

  const downloadBlob = (data: BlobPart, type: string, filename: string) => {
    const blob = new Blob([data], { type })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportModel = async (format: 'glb' | 'obj') => {
    const visible = scene.objects.filter((o) => o.visible !== false && meshRefs.current.has(o.id))
    if (visible.length === 0) {
      toast.error('Aucun objet visible à exporter')
      return
    }
    try {
      const group = new THREE.Group()
      group.name = scene.name
      for (const o of visible) {
        const mesh = meshRefs.current.get(o.id)!
        const clone = mesh.clone()
        clone.name = o.name
        group.add(clone)
      }
      group.updateMatrixWorld(true)
      if (format === 'glb') {
        const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')
        const exporter = new GLTFExporter()
        exporter.parse(
          group,
          (result) => {
            downloadBlob(result as ArrayBuffer, 'model/gltf-binary', `${scene.name || 'scene'}.glb`)
            toast.success('Export GLB terminé — compatible Blender, Roblox Studio (via convertisseur), etc.')
          },
          (err) => {
            console.error(err)
            toast.error('Export GLB impossible')
          },
          { binary: true }
        )
      } else {
        const { OBJExporter } = await import('three/examples/jsm/exporters/OBJExporter.js')
        const text = new OBJExporter().parse(group)
        downloadBlob(text, 'text/plain', `${scene.name || 'scene'}.obj`)
        toast.success('Export OBJ terminé')
      }
    } catch {
      toast.error('Export impossible')
    }
  }

  const exportJSON = () => {
    downloadBlob(JSON.stringify(scene, null, 2), 'application/json', `${scene.name || 'scene'}.nexus.json`)
    toast.success('Projet de scène exporté (JSON)')
  }

  const importJSON = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const raw = JSON.parse(String(reader.result)) as Record<string, unknown>
        const spec = sanitizeScene(raw, 'Scène importée')
        if (!spec) throw new Error('format invalide')
        const rawObjs = Array.isArray(raw.objects) ? (raw.objects as Record<string, unknown>[]) : []
        spec.objects = spec.objects.map((o, i) => {
          const rawKf = rawObjs[i]?.keyframes
          if (Array.isArray(rawKf) && rawKf.length > 0) {
            o.keyframes = rawKf
              .slice(0, 60)
              .filter((k): k is SceneKeyframe =>
                Boolean(k) &&
                Array.isArray((k as SceneKeyframe).position) &&
                Array.isArray((k as SceneKeyframe).rotation) &&
                Array.isArray((k as SceneKeyframe).scale)
              )
          }
          return o
        })
        snapshot(scene)
        setScene(spec)
        setSelectedId(null)
        toast.success(`Scène « ${spec.name} » importée (${spec.objects.length} objets)`)
      } catch (err) {
        toast.error(err instanceof Error ? `Import impossible : ${err.message}` : 'Import impossible')
      }
    }
    reader.readAsText(file)
  }

  const deg = (r: number) => Math.round((r * 180) / Math.PI)
  const rad = (d: number) => (d * Math.PI) / 180

  const measureDistance =
    measureA && measureB ? Math.hypot(measureB[0] - measureA[0], measureB[1] - measureA[1], measureB[2] - measureA[2]) : null
  const duration = scene.animationDuration ?? 6

  return (
    <div className="flex h-full flex-col">
      {/* Barre supérieure */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 bg-card/50 px-3 py-2.5">
        <Input
          value={scene.name}
          onChange={(e) => setScene((s) => ({ ...s, name: e.target.value.slice(0, 60) }))}
          className="h-9 w-40 border-border bg-muted/50 text-sm font-semibold"
          aria-label="Nom de la scène"
        />
        <div className="flex items-center gap-1.5" role="group" aria-label="Mode du gizmo">
          {(['translate', 'rotate', 'scale'] as const).map((m) => (
            <Button
              key={m}
              size="sm"
              variant={gizmoMode === m ? 'default' : 'outline'}
              className={cn(
                'h-9 px-3 text-xs capitalize',
                gizmoMode === m ? 'bg-violet-500 text-white hover:bg-violet-600' : 'border-border hover:bg-accent'
              )}
              onClick={() => setGizmoMode(m)}
            >
              {m === 'translate' ? 'Déplacer' : m === 'rotate' ? 'Pivoter' : 'Échelle'}
            </Button>
          ))}
        </div>

        {/* Annuler / refaire */}
        <div className="flex items-center gap-1" role="group" aria-label="Historique">
          <Button
            size="icon"
            variant="outline"
            className="h-9 w-9 border-border hover:bg-accent disabled:opacity-40"
            onClick={undo}
            disabled={past.length === 0}
            aria-label="Annuler (Ctrl+Z)"
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="h-9 w-9 border-border hover:bg-accent disabled:opacity-40"
            onClick={redo}
            disabled={future.length === 0}
            aria-label="Rétablir (Ctrl+Y)"
          >
            <Redo2 className="h-4 w-4" />
          </Button>
        </div>

        {/* Outil de mesure */}
        <div className="flex items-center gap-1.5" role="group" aria-label="Outil de mesure">
          <Button
            size="sm"
            variant={measureMode ? 'default' : 'outline'}
            className={cn(
              'h-9 gap-1.5 px-3 text-xs',
              measureMode ? 'bg-amber-500 text-white hover:bg-amber-600' : 'border-border hover:bg-accent'
            )}
            onClick={() => {
              setMeasureMode((v) => !v)
              clearMeasure()
            }}
            aria-pressed={measureMode}
          >
            <Ruler className="h-3.5 w-3.5" />
            Mesurer
          </Button>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {/* Vues caméra */}
          <div className="hidden items-center gap-1 lg:flex" role="group" aria-label="Vues de caméra">
            {CAMERA_VIEWS.map((v) => (
              <Button
                key={v.id}
                size="sm"
                variant="outline"
                className="h-9 border-border px-2.5 text-[11px] hover:bg-accent"
                onClick={() => setCameraRequest({ pos: v.pos, target: v.target, nonce: Date.now() })}
                aria-label={`Vue ${v.label}`}
              >
                {v.label}
              </Button>
            ))}
            <Button
              size="icon"
              variant="outline"
              className="h-9 w-9 border-border hover:bg-accent disabled:opacity-40"
              disabled={!selected}
              onClick={() =>
                selected &&
                setCameraRequest({
                  pos: [selected.position[0] + 5, selected.position[1] + 4, selected.position[2] + 5],
                  target: selected.position,
                  nonce: Date.now(),
                })
              }
              aria-label="Recadrer sur la sélection"
            >
              <Focus className="h-4 w-4" />
            </Button>
          </div>

          <Select onValueChange={loadTemplate} value="">
            <SelectTrigger className="h-9 w-32 border-border bg-muted/50 text-xs" aria-label="Charger un template de scène">
              <SelectValue placeholder="Templates…" />
            </SelectTrigger>
            <SelectContent>
              {SCENE_TEMPLATES.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select onValueChange={loadSaved} value="">
            <SelectTrigger className="h-9 w-32 border-border bg-muted/50 text-xs" aria-label="Charger une scène sauvegardée">
              <SelectValue placeholder="Charger…" />
            </SelectTrigger>
            <SelectContent>
              {savedScenes.length === 0 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">Aucune scène sauvegardée</p>
              )}
              {savedScenes.map((s) => (
                <SelectItem key={s.name} value={s.name}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="icon" variant="outline" className="h-9 w-9 border-border hover:bg-accent" onClick={saveScene} aria-label="Sauvegarder la scène">
            <Save className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="outline" className="h-9 w-9 border-border hover:bg-accent" onClick={screenshot} aria-label="Télécharger une capture">
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Barre IA + export */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 px-3 py-2">
        <Sparkles className="h-4 w-4 shrink-0 text-violet-400" />
        <Input
          value={aiPrompt}
          onChange={(e) => setAiPrompt(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && generateAI()}
          placeholder="Génération sémantique IA : décrivez la scène… (ex : une forêt mystique avec des lucioles)"
          className="h-9 min-w-40 flex-1 border-border bg-muted/60 text-sm"
          aria-label="Description de la scène à générer"
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

        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="outline" className="h-9 gap-1.5 border-border text-xs hover:bg-accent" onClick={() => exportModel('glb')}>
            <Download className="h-3.5 w-3.5" /> GLB
          </Button>
          <Button size="sm" variant="outline" className="h-9 gap-1.5 border-border text-xs hover:bg-accent" onClick={() => exportModel('obj')}>
            <Download className="h-3.5 w-3.5" /> OBJ
          </Button>
          <Button size="sm" variant="outline" className="h-9 gap-1.5 border-border text-xs hover:bg-accent" onClick={exportJSON}>
            <Download className="h-3.5 w-3.5" /> JSON
          </Button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) importJSON(f)
              e.target.value = ''
            }}
          />
          <Button size="sm" variant="outline" className="h-9 gap-1.5 border-border text-xs hover:bg-accent" onClick={() => importRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" /> Importer
          </Button>
        </div>
      </div>

      {/* Corps : canvas + panneaux */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Panneau objets */}
        <div className="flex w-full shrink-0 flex-col border-b border-border/70 bg-card/50 lg:w-56 lg:border-b-0 lg:border-r">
          <p className="px-3 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Bibliothèque de primitives
          </p>
          <div className="grid grid-cols-5 gap-1 px-3 lg:grid-cols-3">
            {PRIMITIVE_TYPES.map((type) => {
              const Icon = ADD_ICONS[type]
              return (
                <button
                  key={type}
                  onClick={() => addObject(type)}
                  title={`Ajouter : ${PRIMITIVE_LABELS[type]}`}
                  className="flex flex-col items-center gap-1 rounded-lg border border-border/70 bg-muted/40 px-1 py-2 text-muted-foreground transition-all hover:border-violet-500/50 hover:text-violet-300"
                >
                  <Icon className="h-4 w-4" />
                  <span className="w-full truncate text-center text-[9px] leading-tight">{PRIMITIVE_LABELS[type]}</span>
                </button>
              )
            })}
          </div>
          <div className="mt-3 flex min-h-0 flex-1 flex-col">
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Calques — objets ({scene.objects.length})
            </p>
            <div className="max-h-44 flex-1 overflow-y-auto px-3 pb-3 lg:max-h-none" style={{ scrollbarWidth: 'thin' }}>
              {scene.objects.length === 0 && (
                <p className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground/70">
                  Scène vide — ajoutez des objets, un template ou générez par IA
                </p>
              )}
              <ul className="flex flex-col gap-1">
                {scene.objects.map((o) => (
                  <li
                    key={o.id}
                    className={cn(
                      'group flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs transition-colors',
                      o.id === selectedId
                        ? 'bg-violet-500/15 text-violet-200 shadow-[inset_0_0_0_1px_rgba(168,85,247,0.35)]'
                        : 'text-muted-foreground hover:bg-accent/60'
                    )}
                  >
                    <button
                      onClick={() => patchObject(o.id, { visible: o.visible === false })}
                      className={cn('shrink-0 rounded p-0.5 hover:text-foreground', o.visible === false ? 'text-muted-foreground/40' : 'text-emerald-400/80')}
                      title={o.visible === false ? 'Afficher' : 'Masquer'}
                      aria-label={o.visible === false ? `Afficher ${o.name}` : `Masquer ${o.name}`}
                    >
                      {o.visible === false ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      onClick={() => patchObject(o.id, { locked: !o.locked })}
                      className={cn('shrink-0 rounded p-0.5 hover:text-foreground', o.locked ? 'text-amber-400' : 'text-muted-foreground/50')}
                      title={o.locked ? 'Déverrouiller' : 'Verrouiller'}
                      aria-label={o.locked ? `Déverrouiller ${o.name}` : `Verrouiller ${o.name}`}
                    >
                      {o.locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      onClick={() => setSelectedId(o.id)}
                      className={cn('flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left', o.locked && 'opacity-70')}
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: o.color }} />
                      <span className="truncate">{o.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            {selected && (
              <div className="flex gap-1.5 border-t border-border/70 p-3">
                <Button size="sm" variant="outline" className="h-8 flex-1 gap-1.5 border-border text-xs hover:bg-accent" onClick={duplicateSelected}>
                  <Copy className="h-3.5 w-3.5" /> Dupliquer
                </Button>
                <Button size="sm" variant="outline" className="h-8 flex-1 gap-1.5 border-border text-xs text-rose-400 hover:bg-rose-500/10 hover:text-rose-300" onClick={deleteSelected}>
                  <Trash2 className="h-3.5 w-3.5" /> Suppr.
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Canvas 3D */}
        <div className="relative min-h-[320px] flex-1 bg-zinc-950">
          <Canvas
            shadows
            dpr={[1, 2]}
            camera={{ position: [9, 7, 9], fov: 50 }}
            gl={{ preserveDrawingBuffer: true }}
            onPointerMissed={() => {
              if (!measureMode) setSelectedId(null)
            }}
          >
            <GlBridge onReady={(gl) => { glRef.current = gl }} />
            <CameraRig request={cameraRequest} />
            <color attach="background" args={[scene.background]} />
            <ambientLight intensity={lighting.ambient} />
            <hemisphereLight args={[lighting.hemi[0], lighting.hemi[1], lighting.hemi[2]]} />
            <directionalLight
              position={lighting.dir.position}
              intensity={lighting.dir.intensity}
              color={lighting.dir.color}
              castShadow
              shadow-mapSize={[2048, 2048]}
              shadow-camera-left={-15}
              shadow-camera-right={15}
              shadow-camera-top={15}
              shadow-camera-bottom={-15}
            />
            {lighting.points.map((p, i) => (
              <pointLight key={i} position={p.position} intensity={p.intensity} color={p.color} />
            ))}
            {scene.ground && (
              <>
                <mesh
                  rotation={[-Math.PI / 2, 0, 0]}
                  position={[0, 0, 0]}
                  receiveShadow
                  onPointerDown={(e) => {
                    if (measureMode) {
                      e.stopPropagation()
                      onMeasureClick([e.point.x, e.point.y, e.point.z])
                    }
                  }}
                >
                  <planeGeometry args={[60, 60]} />
                  <meshStandardMaterial color={scene.groundColor} roughness={0.95} metalness={0} />
                </mesh>
                {gridVisible && (
                  <Grid
                    position={[0, 0.002, 0]}
                    infiniteGrid
                    fadeDistance={45}
                    cellSize={Number(gridCell)}
                    sectionSize={Number(gridCell) * 5}
                    cellColor="#27272a"
                    sectionColor="#3f3f46"
                  />
                )}
              </>
            )}
            {scene.objects.map((o) => (
              <SceneMesh
                key={o.id}
                obj={o}
                selected={o.id === selectedId}
                gizmoMode={gizmoMode}
                snap={snapEnabled ? Number(gridCell) : null}
                interactive={!playing && !measureMode}
                onSelect={setSelectedId}
                onTransform={onTransform}
                onTransformStart={onTransformStart}
                onTransformEnd={onTransformEnd}
                registerRef={registerRef}
                onMeasure={onMeasureClick}
                measureMode={measureMode}
              />
            ))}
            {measureA && <MeasureLine a={measureA} b={measureB} />}
            <AnimationPlayer
              scene={scene}
              meshes={meshRefs.current}
              playingRef={playingRef}
              timeRef={timeRef}
              duration={duration}
              onTime={setAnimTime}
            />
            <OrbitControls makeDefault target={[0, 1, 0]} enableDamping dampingFactor={0.08} maxPolarAngle={Math.PI / 2.02} minDistance={2} maxDistance={60} />
          </Canvas>

          {/* Aides flottantes */}
          <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-border/70 bg-card/80 px-3 py-1.5 text-[10px] text-muted-foreground backdrop-blur">
            {measureMode
              ? 'Mode mesure : cliquez 2 points (objets ou sol) — le bouton Mesurer désactive le mode'
              : 'Clic gauche : orbite · Molette : zoom · Clic : sélectionner · Ctrl+Z : annuler'}
          </div>
          {measureDistance !== null && (
            <div className="absolute right-3 top-3 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-200 backdrop-blur">
              <Ruler className="h-3.5 w-3.5" />
              {measureDistance.toFixed(2)} m
              <button onClick={clearMeasure} className="text-amber-300/70 hover:text-amber-200" aria-label="Effacer la mesure">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Inspecteur */}
        <div className="w-full shrink-0 overflow-y-auto border-t border-border/70 bg-card/50 lg:w-64 lg:border-l lg:border-t-0" style={{ scrollbarWidth: 'thin' }}>
          {!selected ? (
            <div className="flex h-full flex-col gap-4 p-4">
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-5 text-center">
                <Lightbulb className="h-5 w-5 text-muted-foreground/70" />
                <p className="text-xs leading-relaxed text-muted-foreground/70">
                  Sélectionnez un objet pour éditer ses propriétés, ses matériaux et ses clés d&apos;animation.
                </p>
              </div>

              {/* Environnements lumineux */}
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Lightbulb className="h-3.5 w-3.5" /> Environnement
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {(Object.keys(LIGHTING_PRESETS) as LightingPreset[]).map((p) => (
                    <Button
                      key={p}
                      size="sm"
                      variant={(scene.lighting ?? 'studio') === p ? 'default' : 'outline'}
                      className={cn(
                        'h-8 text-[11px]',
                        (scene.lighting ?? 'studio') === p
                          ? 'bg-violet-500 text-white hover:bg-violet-600'
                          : 'border-border hover:bg-accent'
                      )}
                      onClick={() => applyLighting(p)}
                    >
                      {LIGHTING_PRESETS[p].label}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Grille ajustable */}
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Grille &amp; aimantation</p>
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2">
                    <span className="text-xs">Afficher la grille</span>
                    <Switch checked={gridVisible} onCheckedChange={setGridVisible} aria-label="Afficher la grille" />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2">
                    <span className="text-xs">Aimanter à la grille</span>
                    <Switch checked={snapEnabled} onCheckedChange={setSnapEnabled} aria-label="Aimanter les déplacements à la grille" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">Cellule</span>
                    <Select value={gridCell} onValueChange={setGridCell}>
                      <SelectTrigger className="h-8 flex-1 border-border bg-muted/50 text-xs" aria-label="Taille de cellule">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0.5">0,5 m</SelectItem>
                        <SelectItem value="1">1 m</SelectItem>
                        <SelectItem value="2">2 m</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4 p-4">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Nom</label>
                <Input
                  value={selected.name}
                  onChange={(e) => patchObject(selected.id, { name: e.target.value.slice(0, 40) })}
                  className="h-8 border-border bg-muted/50 text-sm"
                />
              </div>

              <VecField
                label="Position"
                value={selected.position}
                onChange={(v) => patchObject(selected.id, { position: v })}
              />
              <VecField
                label="Rotation (°)"
                value={[deg(selected.rotation[0]), deg(selected.rotation[1]), deg(selected.rotation[2])]}
                onChange={(v) => patchObject(selected.id, { rotation: [rad(v[0]), rad(v[1]), rad(v[2])] })}
                step={5}
              />
              <VecField
                label="Échelle"
                value={selected.scale}
                onChange={(v) => patchObject(selected.id, { scale: v })}
                step={0.1}
                min={0.05}
              />

              {(CURVED_TYPES.includes(selected.type) || DETAIL_TYPES.includes(selected.type)) && (
                <SliderField
                  label="Lissage (segments)"
                  value={selected.segments ?? 32}
                  min={6}
                  max={64}
                  step={2}
                  onChange={(v) => patchObject(selected.id, { segments: Math.round(v) })}
                />
              )}

              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Couleur</label>
                <input
                  type="color"
                  value={selected.color}
                  onChange={(e) => patchObject(selected.id, { color: e.target.value })}
                  className="h-9 w-full cursor-pointer rounded-lg border border-border bg-muted/50 p-1"
                  aria-label="Couleur de l'objet"
                />
              </div>

              {/* Presets de matériaux PBR */}
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Matériaux PBR</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {MATERIAL_PRESETS.map((p) => (
                    <Button
                      key={p.name}
                      size="sm"
                      variant="outline"
                      className="h-7 border-border px-1.5 text-[10px] hover:bg-accent"
                      onClick={() => patchObject(selected.id, p.patch)}
                    >
                      {p.name}
                    </Button>
                  ))}
                </div>
              </div>

              <SliderField label="Métal" value={selected.metalness} min={0} max={1} step={0.05} onChange={(v) => patchObject(selected.id, { metalness: v })} />
              <SliderField label="Rugosité" value={selected.roughness} min={0} max={1} step={0.05} onChange={(v) => patchObject(selected.id, { roughness: v })} />
              <SliderField label="Opacité" value={selected.opacity} min={0.1} max={1} step={0.05} onChange={(v) => patchObject(selected.id, { opacity: v })} />

              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Émission (néon)</label>
                <input
                  type="color"
                  value={selected.emissive === '#000000' ? '#000000' : selected.emissive}
                  onChange={(e) => patchObject(selected.id, { emissive: e.target.value })}
                  className="h-9 w-full cursor-pointer rounded-lg border border-border bg-muted/50 p-1"
                  aria-label="Couleur d'émission"
                />
              </div>
              <SliderField label="Intensité d'émission" value={selected.emissiveIntensity} min={0} max={3} step={0.1} onChange={(v) => patchObject(selected.id, { emissiveIntensity: v })} />

              {/* Clés d'animation de l'objet */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <Video className="h-3.5 w-3.5" /> Clés d&apos;animation
                  </label>
                  <Button size="sm" variant="outline" className="h-6 gap-1 border-border px-2 text-[10px] hover:bg-accent" onClick={addKeyframe}>
                    <Plus className="h-3 w-3" /> Ajouter
                  </Button>
                </div>
                {(selected.keyframes ?? []).length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border p-2.5 text-center text-[10px] leading-relaxed text-muted-foreground/70">
                    Aucune clé — placez la tête de lecture en bas puis « Ajouter » pour figer la pose actuelle.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {(selected.keyframes ?? [])
                      .slice()
                      .sort((a, b) => a.t - b.t)
                      .map((k) => (
                        <li key={k.t} className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-[11px]">
                          <Film className="h-3 w-3 shrink-0 text-violet-400" />
                          <button
                            className="flex-1 text-left font-mono text-violet-300 hover:text-violet-200"
                            onClick={() => scrubTo(k.t)}
                            title="Aller à cette clé"
                          >
                            {(k.t * 100).toFixed(0)} %
                          </button>
                          <button
                            onClick={() => deleteKeyframe(k.t)}
                            className="shrink-0 rounded p-0.5 text-muted-foreground/50 hover:text-rose-400"
                            aria-label="Supprimer cette clé"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </li>
                      ))}
                  </ul>
                )}
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={scene.background}
                  onChange={(e) => setScene((s) => ({ ...s, background: e.target.value }))}
                  className="h-9 w-12 cursor-pointer rounded-lg border border-border bg-muted/50 p-1"
                  aria-label="Couleur de fond"
                />
                <input
                  type="color"
                  value={scene.groundColor}
                  onChange={(e) => setScene((s) => ({ ...s, groundColor: e.target.value }))}
                  className="h-9 w-12 cursor-pointer rounded-lg border border-border bg-muted/50 p-1"
                  aria-label="Couleur du sol"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 flex-1 gap-1.5 border-border text-xs hover:bg-accent"
                  onClick={() => {
                    snapshot(scene)
                    setScene(DEFAULT_SCENE)
                    setSelectedId(null)
                  }}
                >
                  <Eraser className="h-3.5 w-3.5" /> Tout effacer
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Barre d'animation clé par clé */}
      {animOpen && (
        <div className="flex flex-wrap items-center gap-3 border-t border-border/70 bg-card/60 px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            <Button
              size="icon"
              className="h-8 w-8 rounded-lg bg-violet-500 text-white hover:bg-violet-600"
              onClick={playing ? pauseAnim : playAnim}
              aria-label={playing ? 'Mettre en pause' : 'Lire l\u2019animation'}
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 border-border text-xs hover:bg-accent" onClick={stopAnim}>
              <Square className="h-3 w-3" /> Stop
            </Button>
          </div>
          <div className="flex min-w-40 flex-1 items-center gap-2">
            <Slider
              value={[animTime]}
              min={0}
              max={1}
              step={0.01}
              onValueChange={([v]) => scrubTo(v)}
              disabled={playing}
              aria-label="Tête de lecture"
            />
            <span className="w-14 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
              {(animTime * duration).toFixed(1)}s
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Durée</span>
            <Input
              type="number"
              min={1}
              max={60}
              step={1}
              value={duration}
              onChange={(e) => {
                const n = parseFloat(e.target.value)
                if (Number.isFinite(n)) setScene((s) => ({ ...s, animationDuration: Math.max(1, Math.min(60, n)) }))
              }}
              className="h-8 w-16 border-border bg-muted/50 px-2 text-xs"
              aria-label="Durée totale de l'animation en secondes"
            />
            <span className="text-[11px] text-muted-foreground">s</span>
          </div>
          {!selected && (
            <p className="text-[10px] text-muted-foreground/70">
              Sélectionnez un objet puis « Ajouter » dans l&apos;inspecteur pour poser une clé.
            </p>
          )}
        </div>
      )}
      {!animOpen && (
        <button
          onClick={() => setAnimOpen(true)}
          className="flex items-center gap-1.5 border-t border-border/70 bg-card/60 px-4 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Film className="h-3.5 w-3.5 text-violet-400" />
          Animation clé par clé — ouvrir la timeline
        </button>
      )}
    </div>
  )
}

function VecField({
  label,
  value,
  onChange,
  step = 0.1,
  min = -100,
}: {
  label: string
  value: [number, number, number]
  onChange: (v: [number, number, number]) => void
  step?: number
  min?: number
}) {
  const axes = ['X', 'Y', 'Z'] as const
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
      <div className="grid grid-cols-3 gap-1.5">
        {axes.map((axis, i) => (
          <Input
            key={axis}
            type="number"
            step={step}
            min={min}
            value={Number(value[i].toFixed(2))}
            onChange={(e) => {
              const n = parseFloat(e.target.value)
              if (!Number.isFinite(n)) return
              const next: [number, number, number] = [...value]
              next[i] = n
              onChange(next)
            }}
            className="h-8 border-border bg-muted/50 px-2 text-xs"
            aria-label={`${label} ${axis}`}
          />
        ))}
      </div>
    </div>
  )
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
        <span className="text-[11px] font-mono text-muted-foreground">{value.toFixed(2)}</span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} aria-label={label} />
    </div>
  )
}
