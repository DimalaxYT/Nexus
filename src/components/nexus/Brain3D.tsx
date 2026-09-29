'use client'

// ─── NEXUS — Salle des Cerveaux 3D ───────────────────────────────────────────
// Chaque agent (et NEXUS) est représenté par un cerveau 3D PROCÉDURAL animé :
//   • deux hémisphères aux circonvolutions réalistes (bruit ridge anisotrope),
//     cervelet strié + tronc cérébral ;
//   • le cerveau « respire », tourne, et s'illumine de la couleur de l'agent
//     quand il travaille (thinking) ou parle (speaking) ;
//   • des SYNAPSES scintillent en permanence et des impulsions électriques
//     voyagent le long de la surface pendant la réflexion ;
//   • la PENSÉE EN DIRECT de l'agent (événements agent_thought / thought SSE)
//     s'affiche en bulle flottante au-dessus de son cerveau.
// Tout est local (aucune ressource externe) : géométries générées au montage.

import { useMemo, useRef, useEffect, useState, useCallback } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useNexusStore, type BrainActivityItem } from '@/lib/store'
import type { NexusAgent } from '@/lib/nexus-types'
import { ROLE_LABELS } from '@/lib/nexus-types'
import { cn } from '@/lib/utils'

// ── Bruit déterministe (value noise 3D + fbm) ────────────────────────────────

function hash3(i: number, j: number, k: number): number {
  let n = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1440662683)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295
}

function valueNoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const xf = x - xi
  const yf = y - yi
  const zf = z - zi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const w = zf * zf * (3 - 2 * zf)
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  const c000 = hash3(xi, yi, zi)
  const c100 = hash3(xi + 1, yi, zi)
  const c010 = hash3(xi, yi + 1, zi)
  const c110 = hash3(xi + 1, yi + 1, zi)
  const c001 = hash3(xi, yi, zi + 1)
  const c101 = hash3(xi + 1, yi, zi + 1)
  const c011 = hash3(xi, yi + 1, zi + 1)
  const c111 = hash3(xi + 1, yi + 1, zi + 1)
  return lerp(
    lerp(lerp(c000, c100, u), lerp(c010, c110, u), v),
    lerp(lerp(c001, c101, u), lerp(c011, c111, u), v),
    w
  )
}

/** fbm renvoie ≈ [-1, 1]. */
function fbm(x: number, y: number, z: number, octaves = 3): number {
  let amp = 0.5
  let freq = 1
  let sum = 0
  for (let o = 0; o < octaves; o++) {
    sum += amp * (valueNoise(x * freq, y * freq, z * freq) * 2 - 1)
    freq *= 2.13
    amp *= 0.5
  }
  return sum
}

// ── Géométries procédurales ──────────────────────────────────────────────────

const isNarrow = typeof window !== 'undefined' && window.innerWidth < 768

/** Hémisphère cérébral : ellipsoïde déformé par des circonvolutions ridge. */
export function makeHemisphere(side: 1 | -1, seed: number): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, isNarrow ? 44 : 56, isNarrow ? 34 : 42)
  const pos = geo.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  const dir = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    dir.copy(v).normalize()
    // Ellipsoïde de base (un cerveau est plus long que large)
    const p = v.clone()
    p.multiply(new THREE.Vector3(0.74, 0.9, 1.02))
    // Circonvolutions : plis radialement déplacés, anisotropes (plis surtout
    // horizontaux, comme les gyri réels) + creux entre les plis.
    const n = fbm(p.x * 2.3 + seed * 7.7, p.y * 4.9 + seed * 3.1, p.z * 2.1 + seed, 3)
    const ridge = 1 - Math.abs(n)
    const fold = Math.pow(ridge, 1.7) * 0.085 - 0.024
    // Scissure de Sylvius : crevasse latérale caractéristique
    const sylvius =
      Math.exp(-Math.pow((p.y + 0.02) * 4.2, 2)) *
      Math.exp(-Math.pow((p.z - 0.1) * 2.2, 2)) *
      -0.07 *
      side
    const disp = fold + sylvius
    p.addScaledVector(dir, disp)
    // Base aplatie (face inférieure relativement plate)
    if (p.y < -0.4) p.y = -0.4 + (p.y + 0.4) * 0.38
    // Pôle occipital légèrement resserré
    p.x *= 1 - Math.max(0, -p.z) * 0.16
    pos.setXYZ(i, p.x, p.y, p.z)
  }
  geo.computeVertexNormals()
  return geo
}

/** Cervelet : petit ellipsoïde à fines stries horizontales. */
export function makeCerebellum(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, isNarrow ? 30 : 40, isNarrow ? 22 : 28)
  const pos = geo.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const p = v.clone()
    p.multiply(new THREE.Vector3(0.56, 0.4, 0.44))
    // Folia : fines lamelles horizontales
    const stripe = Math.sin(p.y * 34 + p.z * 6) * 0.016
    const n = fbm(p.x * 6, p.y * 10, p.z * 6, 2) * 0.012
    const r = 1 + stripe + n
    p.multiplyScalar(r)
    pos.setXYZ(i, p.x, p.y, p.z)
  }
  geo.computeVertexNormals()
  return geo
}

/** Échantillonne un point de surface approximatif d'un hémisphère (synapses). */
export function surfacePoint(side: 1 | -1, rnd: () => number): THREE.Vector3 {
  const theta = rnd() * Math.PI * 2
  const phi = Math.acos(2 * rnd() - 1)
  const v = new THREE.Vector3(
    Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta)
  )
  v.multiply(new THREE.Vector3(0.78, 0.94, 1.06))
  if (v.y < -0.35) v.y = -0.35
  v.x += side * 0.44
  return v
}

export const mulberry = (seed: number) => () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// ── Un cerveau d'agent ───────────────────────────────────────────────────────

interface Spark {
  a: THREE.Vector3
  b: THREE.Vector3
  t: number
  speed: number
}

function AgentBrain({
  item,
  position,
  scale = 1,
  registerAnchor,
}: {
  item: BrainActivityItem
  position: [number, number, number]
  scale?: number
  registerAnchor: (id: string, o: THREE.Object3D | null) => void
}) {
  const group = useRef<THREE.Group>(null)
  const spinRef = useRef<THREE.Group>(null)
  const ringRef = useRef<THREE.Mesh>(null)
  const coreMat = useRef<THREE.MeshStandardMaterial>(null)
  const rimMat = useRef<THREE.MeshBasicMaterial>(null)
  const sparkMesh = useRef<THREE.InstancedMesh>(null)
  const synapseMat = useRef<THREE.PointsMaterial>(null)
  const emissive = useRef(0.05)

  const geos = useMemo(
    () => ({
      left: makeHemisphere(1, 1),
      right: makeHemisphere(-1, 2),
      cereb: makeCerebellum(),
    }),
    []
  )

  // Synapses : ~110 points scintillants posés sur les hémisphères
  const synapses = useMemo(() => {
    const rnd = mulberry(42)
    const pts: THREE.Vector3[] = []
    for (let i = 0; i < 110; i++) pts.push(surfacePoint(i % 2 === 0 ? 1 : -1, rnd))
    const arr = new Float32Array(pts.length * 3)
    pts.forEach((p, i) => {
      arr[i * 3] = p.x
      arr[i * 3 + 1] = p.y
      arr[i * 3 + 2] = p.z
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3))
    return g
  }, [])

  const sparksRef = useRef<Spark[] | null>(null)
  if (sparksRef.current === null) {
    const rnd = mulberry(7)
    sparksRef.current = Array.from({ length: 14 }, () => ({
      a: surfacePoint(rnd() > 0.5 ? 1 : -1, rnd),
      b: surfacePoint(rnd() > 0.5 ? 1 : -1, rnd),
      t: rnd(),
      speed: 0.35 + rnd() * 0.8,
    }))
  }
  const dummyRef = useRef<THREE.Object3D | null>(null)
  if (dummyRef.current === null) dummyRef.current = new THREE.Object3D()

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const active = item.status !== 'idle'
    const speaking = item.status === 'speaking'

    // Respiration + rotation
    if (group.current) {
      const speed = speaking ? 5.2 : active ? 3.8 : 1.5
      const amp = active ? 0.03 : 0.012
      group.current.scale.setScalar(scale * (1 + Math.sin(t * speed) * amp))
    }
    if (spinRef.current) spinRef.current.rotation.y += delta * (active ? 0.5 : 0.16)

    // Émissive : lerp doux vers l'intensité cible
    const target = speaking ? 0.85 : active ? 0.5 : 0.07
    emissive.current += (target - emissive.current) * Math.min(1, delta * 3.2)
    if (coreMat.current) {
      coreMat.current.emissiveIntensity = emissive.current
    }
    if (rimMat.current) rimMat.current.opacity = 0.05 + emissive.current * 0.16
    if (synapseMat.current) {
      synapseMat.current.opacity = active ? 0.65 + Math.sin(t * 7) * 0.25 : 0.22 + Math.sin(t * 1.8) * 0.08
      synapseMat.current.size = active ? 0.05 : 0.035
    }

    // Halo au sol quand actif
    if (ringRef.current) {
      ringRef.current.rotation.z += delta * (speaking ? 1.6 : 0.7)
      const mat = ringRef.current.material as THREE.MeshBasicMaterial
      mat.opacity = active ? 0.5 + Math.sin(t * 4) * 0.2 : 0.1
    }

    // Impulsions électriques entre synapses
    const sparks = sparksRef.current ?? []
    const dummy = dummyRef.current
    if (sparkMesh.current && dummy) {
      for (let i = 0; i < sparks.length; i++) {
        const s = sparks[i]
        s.t += delta * s.speed * (active ? 1.6 : 0.25)
        if (s.t >= 1) {
          s.t = 0
          const rnd = mulberry(Date.now() + i * 977)
          s.a = surfacePoint(rnd() > 0.5 ? 1 : -1, rnd)
          s.b = surfacePoint(rnd() > 0.5 ? 1 : -1, rnd)
        }
        // Quadratique : contrôle poussé vers l'extérieur (l'influx "saute")
        const mid = s.a.clone().add(s.b).multiplyScalar(0.5)
        mid.multiplyScalar(1.18)
        const oneMinus = 1 - s.t
        const p = new THREE.Vector3()
          .addScaledVector(s.a, oneMinus * oneMinus)
          .addScaledVector(mid, 2 * oneMinus * s.t)
          .addScaledVector(s.b, s.t * s.t)
        dummy.position.copy(p)
        const pulse = 0.05 + (active ? 0.045 * Math.sin(s.t * Math.PI) : 0.01)
        dummy.scale.setScalar(pulse)
        dummy.updateMatrix()
        sparkMesh.current.setMatrixAt(i, dummy.matrix)
      }
      sparkMesh.current.instanceMatrix.needsUpdate = true
    }
  })

  const color = new THREE.Color(item.color || '#a78bfa')
  const pink = new THREE.Color('#dfa0a8')
  const pinkDark = new THREE.Color('#c98f9a')

  return (
    <group position={position}>
      <group ref={group} scale={scale}>
        <group ref={spinRef}>
          <mesh geometry={geos.left} position={[0.05, 0.12, 0.02]} rotation={[0, 0, 0.05]} castShadow={false}>
            <meshStandardMaterial
              ref={coreMat}
              color={pink}
              emissive={color}
              emissiveIntensity={0.07}
              roughness={0.48}
              metalness={0.04}
            />
          </mesh>
          <mesh geometry={geos.right} position={[-0.05, 0.12, 0.02]} rotation={[0, 0, -0.05]}>
            <meshStandardMaterial color={pink} emissive={color} emissiveIntensity={0.07} roughness={0.48} metalness={0.04} />
          </mesh>
          {/* Cervelet + tronc */}
          <mesh geometry={geos.cereb} position={[0, -0.48, -0.62]} rotation={[0.28, 0, 0]}>
            <meshStandardMaterial color={pinkDark} emissive={color} emissiveIntensity={0.05} roughness={0.55} metalness={0.02} />
          </mesh>
          <mesh position={[0, -0.52, -0.22]} rotation={[1.25, 0, 0]}>
            <cylinderGeometry args={[0.13, 0.17, 0.5, 14]} />
            <meshStandardMaterial color="#c3888f" roughness={0.6} />
          </mesh>
          {/* Synapses scintillantes */}
          <points geometry={synapses}>
            <pointsMaterial
              ref={synapseMat}
              color="#ffe1a8"
              size={0.04}
              transparent
              opacity={0.3}
              sizeAttenuation
              depthWrite={false}
            />
          </points>
          {/* Impulsions (instanced) */}
          <instancedMesh ref={sparkMesh} args={[undefined, undefined, 14]}>
            <sphereGeometry args={[1, 8, 8]} />
            <meshBasicMaterial color={color} transparent opacity={0.9} toneMapped={false} />
          </instancedMesh>
          {/* Lueur latérale (rim) */}
          <mesh scale={1.035}>
            <sphereGeometry args={[1.02, 32, 24]} />
            <meshBasicMaterial ref={rimMat} color={color} transparent opacity={0.06} side={THREE.BackSide} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
        </group>
        {/* Halo au sol */}
        <mesh ref={ringRef} position={[0, -1.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.95, 1.18, 48]} />
          <meshBasicMaterial color={color} transparent opacity={0.14} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      </group>

      {/* Ancre du label : projeté en DOM overlay chaque frame (pas de portal React) */}
      <group ref={(o) => registerAnchor(item.id, o)} position={[0, 1.62, 0]} />
    </group>
  )
}

// ── Synchronisation des labels : projection 3D → DOM ─────────────────────────

function LabelSync({ anchors }: { anchors: React.RefObject<Map<string, THREE.Object3D>> }) {
  const { camera, size } = useThree()
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const map = anchors.current
    if (!map) return
    for (const [id, obj] of map) {
      const el = document.getElementById(`brain-label-${id}`)
      if (!el) continue
      obj.getWorldPosition(v)
      v.project(camera)
      const x = (v.x * 0.5 + 0.5) * size.width
      const y = (-v.y * 0.5 + 0.5) * size.height
      el.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`
      el.style.opacity = v.z < 1 ? '1' : '0'
    }
  })
  return null
}

// ── Poussière ambiante (vie de la scène) ─────────────────────────────────────

function Dust() {
  const ref = useRef<THREE.Points>(null)
  const geo = useMemo(() => {
    const rnd = mulberry(99)
    const arr = new Float32Array(180 * 3)
    for (let i = 0; i < 180; i++) {
      arr[i * 3] = (rnd() - 0.5) * 18
      arr[i * 3 + 1] = (rnd() - 0.5) * 10
      arr[i * 3 + 2] = (rnd() - 0.5) * 10
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3))
    return g
  }, [])
  useFrame((state, delta) => {
    if (ref.current) {
      ref.current.rotation.y += delta * 0.02
      ref.current.position.y = Math.sin(state.clock.elapsedTime * 0.24) * 0.25
    }
  })
  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial color="#8f7bd8" size={0.035} transparent opacity={0.4} sizeAttenuation depthWrite={false} />
    </points>
  )
}

// ── Disposition des cerveaux ─────────────────────────────────────────────────

function layout(n: number): [number, number, number][] {
  if (n <= 1) return [[0, 0, 0]]
  if (n === 2) return [[-2.1, 0, 0.2], [2.1, 0, 0.2]]
  if (n === 3) return [[-2.2, 0.15, 0.6], [2.2, 0.15, 0.6], [0, 0.15, -1.7]]
  const half = Math.ceil(n / 2)
  const out: [number, number, number][] = []
  for (let i = 0; i < n; i++) {
    const row = i < half ? 0 : 1
    const col = i % half
    const x = (col - (Math.min(half, n - row * half) - 1) / 2) * 4.3
    out.push([x, row === 0 ? 0.25 : -0.55, row === 0 ? -1.75 : 1.45])
  }
  return out
}

// ── Scène complète ───────────────────────────────────────────────────────────

const MAX_BRAINS = 7

export function BrainCanvas({ className }: { className?: string }) {
  const brainActivity = useNexusStore((s) => s.brainActivity)
  const [agents, setAgents] = useState<NexusAgent[]>([])

  useEffect(() => {
    fetch('/api/agents')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (Array.isArray(d?.agents)) setAgents(d.agents as NexusAgent[])
      })
      .catch(() => {})
  }, [])

  const brains = useMemo<BrainActivityItem[]>(() => {
    const nexus: BrainActivityItem =
      brainActivity['nexus'] ?? {
        id: 'nexus',
        name: 'NEXUS',
        emoji: '🟣',
        color: '#a78bfa',
        role: 'Coordinateur',
        status: 'idle',
        thought: '',
        at: 0,
      }
    // Agents : actifs d'abord (dernière activité), puis le reste de l'équipe.
    // L'activité live est indexée par ID (événements speaker) OU par NOM
    // (pensées collectives agent_thought / délibération) → on regarde les deux.
    const agentItems: BrainActivityItem[] = agents
      .filter((a) => a.enabled)
      .map((a) => {
        const live = brainActivity[a.id] ?? brainActivity[a.name]
        return {
          id: a.id,
          name: a.name,
          emoji: a.emoji,
          color: a.color,
          role: ROLE_LABELS[a.role],
          status: live?.status ?? 'idle',
          thought: live?.thought ?? '',
          at: live?.at ?? 0,
        }
      })
      .sort((a, b) => (b.status !== 'idle' ? 1 : 0) - (a.status !== 'idle' ? 1 : 0) || b.at - a.at)
    return [nexus, ...agentItems].slice(0, MAX_BRAINS)
  }, [agents, brainActivity])

  const positions = useMemo(() => layout(brains.length), [brains.length])
  const hiddenCount = Math.max(0, agents.filter((a) => a.enabled).length + 1 - MAX_BRAINS)
  // Cadrage adaptatif : plus d'équipe → caméra plus loin
  const camZ = brains.length <= 2 ? 8.6 : brains.length <= 4 ? 9.8 : 12.2
  const anchorMap = useRef<Map<string, THREE.Object3D>>(new Map())
  const registerAnchor = useCallback((id: string, o: THREE.Object3D | null) => {
    if (o) anchorMap.current.set(id, o)
    else anchorMap.current.delete(id)
  }, [])

  return (
    <div className={cn('relative h-full w-full overflow-hidden', className)}>
      {/* Fond spatial (derrière le canvas transparent) */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 50% 35%, rgba(124,58,237,0.16), transparent 70%), radial-gradient(ellipse 60% 45% at 20% 80%, rgba(236,72,153,0.10), transparent 70%), radial-gradient(ellipse 55% 40% at 85% 75%, rgba(56,189,248,0.08), transparent 70%)',
        }}
      />
      <Canvas
        camera={{ position: [0, 1.35, camZ], fov: 42 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: true }}
        style={{ position: 'absolute', inset: 0 }}
      >
        <ambientLight intensity={0.55} />
        <directionalLight position={[3.5, 5, 4]} intensity={1.15} color="#fff1e6" />
        <directionalLight position={[-4, -2, -3]} intensity={0.4} color="#8b5cf6" />
        <pointLight position={[0, 0.5, 6.5]} intensity={0.35} color="#f0abfc" />
        <Dust />
        {brains.map((b, i) => (
          <AgentBrain
            key={b.id}
            item={b}
            position={positions[i]}
            scale={b.id === 'nexus' ? 1.16 : 1}
            registerAnchor={registerAnchor}
          />
        ))}
        <LabelSync anchors={anchorMap} />
        <OrbitControls
          enablePan={false}
          enableZoom
          minDistance={5}
          maxDistance={18}
          maxPolarAngle={Math.PI / 1.7}
          autoRotate
          autoRotateSpeed={0.45}
          target={[0, 0, 0]}
        />
      </Canvas>

      {/* Overlay des labels (positions mises à jour chaque frame par LabelSync) */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {brains.map((b) => (
          <div
            key={`label-${b.id}`}
            id={`brain-label-${b.id}`}
            className="absolute left-0 top-0 w-48 will-change-transform"
            style={{ transform: 'translate(-9999px, -9999px)' }}
          >
            <div className="rounded-xl border border-white/10 bg-black/70 px-2.5 py-1.5 shadow-xl backdrop-blur-md">
              <p className="flex items-center gap-1.5 text-[12px] font-bold leading-none text-white">
                <span>{b.emoji}</span>
                <span className="truncate">{b.name}</span>
                <span
                  className={cn(
                    'ml-auto inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                    b.status === 'speaking' ? 'animate-pulse' : b.status === 'thinking' ? 'animate-ping' : 'opacity-40'
                  )}
                  style={{ backgroundColor: b.color || '#a78bfa' }}
                />
              </p>
              {b.role && <p className="mt-0.5 text-[9px] uppercase tracking-wider text-white/50">{b.role}</p>}
              <p
                className={cn(
                  'mt-1 line-clamp-3 text-[10px] leading-snug text-white/80',
                  b.status !== 'idle' ? 'opacity-100' : 'opacity-45'
                )}
              >
                {b.thought
                  ? `« ${b.thought} »`
                  : b.status === 'thinking'
                    ? 'réfléchit…'
                    : b.status === 'speaking'
                      ? 'prend la parole…'
                      : 'en veille — synapses au repos'}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Légende */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-gradient-to-t from-background/85 to-transparent px-4 pb-3 pt-8 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-violet-400" /> veille (respiration lente)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 animate-ping rounded-full bg-amber-400" /> réflexion (impulsions rapides)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" /> prise de parole (halo intense)
        </span>
        {hiddenCount > 0 && <span className="italic">+ {hiddenCount} autre(s) cerveau(x) hors champ</span>}
        <span className="hidden sm:inline">— glisse pour tourner, molette pour zoomer</span>
      </div>
    </div>
  )
}

// ── Vue page complète (AppShell) — voir BrainView.tsx (bascule Jarvis/Éclaté) ─
