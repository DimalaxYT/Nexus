'use client'

// ─── NEXUS — Cerveau JARVIS : un cerveau central unique relié aux agents ─────
// Inspiré de l'interface J.A.R.V.I.S. : UN cerveau organique animé (respiration,
// circonvolutions, synapses, impulsions) enveloppé d'un hologramme cyan avec
// anneaux gyroscopiques et anneau de scan vertical — chaque agent de l'équipe
// est un NŒUD en orbite relié au cerveau par un LIEN ÉNERGÉTIQUE sur lequel
// voyagent des impulsions en direct quand l'agent réfléchit ou parle.
// 100 % procédural et local : aucune ressource externe.

import { useMemo, useRef, useEffect, useState, useCallback } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useNexusStore, type BrainActivityItem } from '@/lib/store'
import type { NexusAgent } from '@/lib/nexus-types'
import { ROLE_LABELS } from '@/lib/nexus-types'
import { cn } from '@/lib/utils'
import { makeHemisphere, makeCerebellum, surfacePoint, mulberry } from './Brain3D'

const CYAN = '#22d3ee'
const CYAN_SOFT = '#67e8f9'
const VIOLET = '#8b5cf6'

const isNarrow = typeof window !== 'undefined' && window.innerWidth < 768

// ── Cerveau central holographique ────────────────────────────────────────────

/** Niveau d'activité global (0→1) : NEXUS + agents actifs. */
function teamActivity(items: BrainActivityItem[]): number {
  let a = 0
  for (const it of items) {
    if (it.status === 'speaking') a += 0.6
    else if (it.status === 'thinking') a += 0.35
  }
  return Math.min(1, a)
}

function HoloBrain({ items }: { items: BrainActivityItem[] }) {
  const group = useRef<THREE.Group>(null)
  const spin = useRef<THREE.Group>(null)
  const coreMat = useRef<THREE.MeshStandardMaterial>(null)
  const wireMat = useRef<THREE.MeshBasicMaterial>(null)
  const rimMat = useRef<THREE.MeshBasicMaterial>(null)
  const synapseMat = useRef<THREE.PointsMaterial>(null)
  const sparkMesh = useRef<THREE.InstancedMesh>(null)
  const scanRef = useRef<THREE.Mesh>(null)
  const scanMat = useRef<THREE.MeshBasicMaterial>(null)
  const ring1 = useRef<THREE.Mesh>(null)
  const ring2 = useRef<THREE.Mesh>(null)
  const ring3 = useRef<THREE.Mesh>(null)
  const haloMat = useRef<THREE.MeshBasicMaterial>(null)
  const innerLight = useRef<THREE.PointLight>(null)
  const emissive = useRef(0.1)
  const activity = useRef(0)

  const geos = useMemo(
    () => ({
      left: makeHemisphere(1, 1),
      right: makeHemisphere(-1, 2),
      cereb: makeCerebellum(),
    }),
    []
  )

  // Synapses + impulsions internes (comme un vrai cerveau, en plus dense)
  const synapses = useMemo(() => {
    const rnd = mulberry(11)
    const arr = new Float32Array(150 * 3)
    for (let i = 0; i < 150; i++) {
      const p = surfacePoint(i % 2 === 0 ? 1 : -1, rnd)
      arr[i * 3] = p.x
      arr[i * 3 + 1] = p.y
      arr[i * 3 + 2] = p.z
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3))
    return g
  }, [])

  const sparksRef = useRef<{ a: THREE.Vector3; b: THREE.Vector3; t: number; speed: number }[] | null>(null)
  if (sparksRef.current === null) {
    const rnd = mulberry(23)
    sparksRef.current = Array.from({ length: 22 }, () => ({
      a: surfacePoint(rnd() > 0.5 ? 1 : -1, rnd),
      b: surfacePoint(rnd() > 0.5 ? 1 : -1, rnd),
      t: rnd(),
      speed: 0.4 + rnd() * 0.9,
    }))
  }
  const dummyRef = useRef<THREE.Object3D | null>(null)
  if (dummyRef.current === null) dummyRef.current = new THREE.Object3D()

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const nexus = items.find((i) => i.id === 'nexus')
    const nexusActive = nexus?.status !== 'idle'
    const speaking = nexus?.status === 'speaking'
    activity.current += (teamActivity(items) - activity.current) * Math.min(1, delta * 2.5)

    // Respiration + rotation (le cerveau « bouge » en permanence)
    if (group.current) {
      const speed = speaking ? 4.6 : nexusActive ? 3.4 : 1.6
      const amp = nexusActive ? 0.035 : 0.014
      group.current.scale.setScalar(2.15 * (1 + Math.sin(t * speed) * amp))
      group.current.position.y = 0.35 + Math.sin(t * 0.9) * 0.07 // lévitation douce
    }
    if (spin.current) {
      spin.current.rotation.y += delta * (nexusActive ? 0.42 : 0.14)
      spin.current.rotation.z = Math.sin(t * 0.31) * 0.045 // balancement organique
    }

    // Émissive : lerp vers l'intensité cible (veille → réflexion → parole)
    const target = speaking ? 0.95 : nexusActive ? 0.55 : 0.12 + activity.current * 0.25
    emissive.current += (target - emissive.current) * Math.min(1, delta * 3)
    if (coreMat.current) coreMat.current.emissiveIntensity = emissive.current
    if (wireMat.current) wireMat.current.opacity = 0.05 + emissive.current * 0.13
    if (rimMat.current) rimMat.current.opacity = 0.05 + emissive.current * 0.14
    if (synapseMat.current) {
      synapseMat.current.opacity = 0.35 + emissive.current * 0.5 + Math.sin(t * 6) * 0.12
      synapseMat.current.size = 0.045 + activity.current * 0.02
    }
    if (innerLight.current) innerLight.current.intensity = 0.6 + emissive.current * 2.2

    // Anneaux gyroscopiques : 3 rotations croisées, accélèrent avec l'activité
    const ringSpeed = 0.25 + activity.current * 0.85
    if (ring1.current) {
      ring1.current.rotation.z += delta * ringSpeed
      ring1.current.rotation.x = 0.42 + Math.sin(t * 0.4) * 0.06
    }
    if (ring2.current) {
      ring2.current.rotation.y += delta * (ringSpeed * 1.35)
      ring2.current.rotation.x = -0.9
    }
    if (ring3.current) {
      ring3.current.rotation.z -= delta * (ringSpeed * 0.7)
      ring3.current.rotation.y = Math.sin(t * 0.23) * 0.3
      ring3.current.rotation.x = 1.25
    }

    // Anneau de SCAN : balaie verticalement le cerveau, rayon = section de la sphère
    if (scanRef.current && scanMat.current) {
      const R = 2.32
      const y = Math.sin(t * 0.55) * R * 0.86
      const r = Math.sqrt(Math.max(0.05, R * R - y * y))
      scanRef.current.position.y = y
      scanRef.current.scale.setScalar(r)
      scanMat.current.opacity = 0.22 + Math.sin(t * 3.1) * 0.08
    }

    // Halo au sol
    if (haloMat.current) haloMat.current.opacity = 0.14 + activity.current * 0.25 + Math.sin(t * 2.2) * 0.05

    // Impulsions internes
    const sparks = sparksRef.current ?? []
    const dummy = dummyRef.current
    if (sparkMesh.current && dummy) {
      for (let i = 0; i < sparks.length; i++) {
        const s = sparks[i]
        s.t += delta * s.speed * (nexusActive ? 1.7 : 0.3)
        if (s.t >= 1) {
          s.t = 0
          const rnd = mulberry(Date.now() + i * 613)
          s.a = surfacePoint(rnd() > 0.5 ? 1 : -1, rnd)
          s.b = surfacePoint(rnd() > 0.5 ? 1 : -1, rnd)
        }
        const mid = s.a.clone().add(s.b).multiplyScalar(0.5).multiplyScalar(1.16)
        const o = 1 - s.t
        const p = new THREE.Vector3()
          .addScaledVector(s.a, o * o)
          .addScaledVector(mid, 2 * o * s.t)
          .addScaledVector(s.b, s.t * s.t)
        dummy.position.copy(p)
        dummy.scale.setScalar(0.055 + (nexusActive ? 0.05 * Math.sin(s.t * Math.PI) : 0.012))
        dummy.updateMatrix()
        sparkMesh.current.setMatrixAt(i, dummy.matrix)
      }
      sparkMesh.current.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <>
      <group ref={group} scale={2.15}>
        <group ref={spin}>
          {/* Cerveau organique (même génération que la salle des cerveaux) */}
          <mesh geometry={geos.left} position={[0.05, 0.12, 0.02]}>
            <meshStandardMaterial ref={coreMat} color="#dfa0a8" emissive={new THREE.Color(CYAN)} emissiveIntensity={0.1} roughness={0.42} metalness={0.08} />
          </mesh>
          <mesh geometry={geos.right} position={[-0.05, 0.12, 0.02]}>
            <meshStandardMaterial color="#dfa0a8" emissive={new THREE.Color(CYAN)} emissiveIntensity={0.1} roughness={0.42} metalness={0.08} />
          </mesh>
          <mesh geometry={geos.cereb} position={[0, -0.48, -0.62]} rotation={[0.28, 0, 0]}>
            <meshStandardMaterial color="#c98f9a" emissive={new THREE.Color(CYAN)} emissiveIntensity={0.08} roughness={0.5} />
          </mesh>
          <mesh position={[0, -0.52, -0.22]} rotation={[1.25, 0, 0]}>
            <cylinderGeometry args={[0.13, 0.17, 0.5, 14]} />
            <meshStandardMaterial color="#c3888f" roughness={0.6} />
          </mesh>
          {/* Enveloppe HOLOGRAMME : mêmes géométries en fil de fer cyan additif */}
          <mesh geometry={geos.left} position={[0.05, 0.12, 0.02]}>
            <meshBasicMaterial ref={wireMat} color={CYAN_SOFT} wireframe transparent opacity={0.08} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
          {/* Coque lumineuse */}
          <mesh scale={1.05}>
            <sphereGeometry args={[1.04, 32, 24]} />
            <meshBasicMaterial ref={rimMat} color={CYAN} transparent opacity={0.06} side={THREE.BackSide} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
          {/* Synapses + impulsions */}
          <points geometry={synapses}>
            <pointsMaterial ref={synapseMat} color="#bff6ff" size={0.045} transparent opacity={0.4} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} />
          </points>
          <instancedMesh ref={sparkMesh} args={[undefined, undefined, 22]}>
            <sphereGeometry args={[1, 8, 8]} />
            <meshBasicMaterial color={CYAN_SOFT} transparent opacity={0.95} toneMapped={false} blending={THREE.AdditiveBlending} depthWrite={false} />
          </instancedMesh>
        </group>
      </group>

      {/* Lumière interne : le cerveau illumine la scène */}
      <pointLight ref={innerLight} position={[0, 0.4, 0]} intensity={0.8} distance={14} color={CYAN} />

      {/* Anneaux gyroscopiques JARVIS */}
      <mesh ref={ring1} rotation={[0.42, 0, 0]}>
        <torusGeometry args={[3.15, 0.014, 8, 96]} />
        <meshBasicMaterial color={CYAN} transparent opacity={0.4} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={ring2} rotation={[-0.9, 0, 0]}>
        <torusGeometry args={[3.55, 0.01, 8, 96]} />
        <meshBasicMaterial color={VIOLET} transparent opacity={0.3} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={ring3} rotation={[1.25, 0, 0]}>
        <torusGeometry args={[3.9, 0.008, 8, 96]} />
        <meshBasicMaterial color={CYAN_SOFT} transparent opacity={0.22} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>

      {/* Anneau de scan vertical */}
      <mesh ref={scanRef} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1, 0.02, 8, 80]} />
        <meshBasicMaterial ref={scanMat} color={CYAN_SOFT} transparent opacity={0.25} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>

      {/* Halo au sol + grille polaire */}
      <mesh position={[0, -2.35, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.6, 3.4, 64]} />
        <meshBasicMaterial ref={haloMat} color={CYAN} transparent opacity={0.16} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <PolarGrid />
    </>
  )
}

/** Grille polaire au sol, façon HUD Jarvis. */
function PolarGrid() {
  const ref = useRef<THREE.Group>(null)
  useFrame((state, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.05
  })
  const rings = useMemo(() => [2.2, 3.6, 5.0, 6.4], [])
  return (
    <group ref={ref} position={[0, -2.36, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      {rings.map((r, i) => (
        <mesh key={i}>
          <ringGeometry args={[r - 0.006, r + 0.006, 96]} />
          <meshBasicMaterial color={VIOLET} transparent opacity={0.1} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      ))}
      {Array.from({ length: 12 }, (_, i) => (
        <mesh key={`rad-${i}`} rotation={[0, 0, (i / 12) * Math.PI * 2]} position={[3.6, 0, 0]}>
          <planeGeometry args={[2.8, 0.008]} />
          <meshBasicMaterial color={VIOLET} transparent opacity={0.06} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      ))}
    </group>
  )
}

// ── Nœuds des agents + liens énergétiques ────────────────────────────────────

const LINK_POINTS = 26
const PULSES_PER_NODE = 3

interface NodeState {
  angle: number
  height: number
  pulses: { t: number; dir: 1 | -1 }[]
}

function AgentNetwork({
  items,
  registerAnchor,
}: {
  items: BrainActivityItem[] // agents SANS NEXUS
  registerAnchor: (id: string, o: THREE.Object3D | null) => void
}) {
  const nodeGroups = useRef<(THREE.Group | null)[]>([])
  const nodeMeshes = useRef<(THREE.MeshStandardMaterial | null)[]>([])
  const shellMeshes = useRef<(THREE.MeshBasicMaterial | null)[]>([])
  const pulseMesh = useRef<THREE.InstancedMesh>(null)
  const containerRef = useRef<THREE.Group>(null)
  const dummyRef = useRef<THREE.Object3D | null>(null)
  if (dummyRef.current === null) dummyRef.current = new THREE.Object3D()

  const ORBIT = isNarrow ? 4.35 : 5.0
  const count = items.length

  /**
   * Runtime impératif (lignes THREE + états d'orbite + courbes) : construit
   * et attaché au conteneur DANS useFrame — jamais lu pendant le rendu, ce
   * qui satisfait les règles react-hooks (refs + immutability). Les lignes
   * sont des objets THREE imperatifs (<line> JSX entre en conflit avec SVG).
   */
  interface NetworkRuntime {
    count: number
    lines: THREE.Line[]
    states: NodeState[]
    beziers: THREE.QuadraticBezierCurve3[]
  }
  const rt = useRef<NetworkRuntime | null>(null)

  useFrame((state, delta) => {
    // (Re)construction paresseuse — y compris si le nombre d'agents a changé
    if (!rt.current || rt.current.count !== count) {
      const container = containerRef.current
      if (container) {
        const old = rt.current
        if (old) {
          for (const l of old.lines) {
            container.remove(l)
            l.geometry.dispose()
            ;(l.material as THREE.Material).dispose()
          }
        }
        const rnd = mulberry(77)
        const lines: THREE.Line[] = []
        const states: NodeState[] = []
        const beziers: THREE.QuadraticBezierCurve3[] = []
        for (let i = 0; i < count; i++) {
          const g = new THREE.BufferGeometry()
          g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LINK_POINTS * 3), 3))
          const m = new THREE.LineBasicMaterial({
            color: new THREE.Color(items[i]?.color || CYAN),
            transparent: true,
            opacity: 0.2,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false,
          })
          const line = new THREE.Line(g, m)
          lines.push(line)
          container.add(line)
          states.push({
            angle: (i / Math.max(1, count)) * Math.PI * 2 + rnd() * 0.5,
            height: Math.sin(i * 2.4) * 0.55,
            pulses: Array.from({ length: PULSES_PER_NODE }, (__, j) => ({
              t: rnd(),
              dir: j % 2 === 0 ? 1 : -1,
            })),
          })
          beziers.push(new THREE.QuadraticBezierCurve3())
        }
        rt.current = { count, lines, states, beziers }
      }
    }

    const runtime = rt.current
    if (!runtime) return
    const t = state.clock.elapsedTime
    const dummy = dummyRef.current
    const brainCenter = new THREE.Vector3(0, 0.35, 0)
    const brainRadius = 2.15

    for (let i = 0; i < count; i++) {
      const item = items[i]
      const st = runtime.states[i]
      const curve = runtime.beziers[i]
      const line = runtime.lines[i]
      if (!item || !st || !curve || !line) continue
      const active = item.status !== 'idle'
      const speaking = item.status === 'speaking'

      // Orbite lente + flottement doux
      st.angle += delta * 0.055
      const x = Math.cos(st.angle) * ORBIT
      const z = Math.sin(st.angle) * ORBIT
      const y = st.height + Math.sin(t * 0.8 + i * 1.7) * 0.18
      const nodePos = new THREE.Vector3(x, y, z)
      const group = nodeGroups.current[i]
      if (group) {
        group.position.copy(nodePos)
        group.rotation.y = -st.angle + Math.PI / 2 // fait face au centre
      }

      // Couleur / intensité du nœud
      const nodeColor = new THREE.Color(item.color || CYAN)
      const targetI = speaking ? 1.5 : active ? 0.95 : 0.3
      const mat = nodeMeshes.current[i]
      if (mat) {
        mat.emissive.lerp(nodeColor, Math.min(1, delta * 4))
        mat.emissiveIntensity += (targetI + Math.sin(t * (speaking ? 6 : active ? 3.5 : 1.2)) * (active ? 0.22 : 0.05) - mat.emissiveIntensity) * Math.min(1, delta * 4)
      }
      const shell = shellMeshes.current[i]
      if (shell) shell.opacity = active ? 0.3 + Math.sin(t * 4) * 0.12 : 0.1

      // Lien énergétique : bézier du cerveau vers le nœud (mise à jour par frame)
      const start = brainCenter.clone().add(nodePos.clone().sub(brainCenter).normalize().multiplyScalar(brainRadius * 0.92))
      const mid = start.clone().add(nodePos).multiplyScalar(0.5)
      mid.y += 0.55 + Math.sin(t * 0.9 + i) * 0.1 // arc vers le haut
      curve.v0.copy(start)
      curve.v1.copy(mid)
      curve.v2.copy(nodePos)
      const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute
      const arr = attr.array as Float32Array
      for (let p = 0; p < LINK_POINTS; p++) {
        const pt = curve.getPoint(p / (LINK_POINTS - 1))
        arr[p * 3] = pt.x
        arr[p * 3 + 1] = pt.y
        arr[p * 3 + 2] = pt.z
      }
      attr.needsUpdate = true
      const lmat = line.material as THREE.LineBasicMaterial
      lmat.opacity = speaking ? 0.85 : active ? 0.55 : 0.16 + Math.sin(t * 1.4 + i) * 0.05
      lmat.color.lerp(nodeColor, Math.min(1, delta * 4))

      // Impulsions le long du lien (réflexion → vers le cerveau, parole → retour)
      if (pulseMesh.current && dummy) {
        for (let p = 0; p < PULSES_PER_NODE; p++) {
          const pulse = st.pulses[p]
          const speed = active ? (speaking ? 1.15 : 0.85) : 0.14
          pulse.t += delta * speed
          if (pulse.t >= 1) pulse.t -= 1
          const tt = pulse.dir === 1 ? pulse.t : 1 - pulse.t
          const pt = curve.getPoint(Math.max(0, Math.min(1, tt)))
          dummy.position.copy(pt)
          const glow = active ? 0.075 + 0.05 * Math.sin(pulse.t * Math.PI) : 0.028
          dummy.scale.setScalar(glow)
          dummy.updateMatrix()
          pulseMesh.current.setMatrixAt(i * PULSES_PER_NODE + p, dummy.matrix)
        }
      }
    }
    if (pulseMesh.current) pulseMesh.current.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      {/* Conteneur des liens : les lignes THREE y sont attachées dans useFrame */}
      <group ref={containerRef} />

      {/* Impulsions (instanced : 3 par agent) */}
      <instancedMesh ref={pulseMesh} args={[undefined, undefined, Math.max(1, count) * PULSES_PER_NODE]}>
        <sphereGeometry args={[1, 8, 8]} />
        <meshBasicMaterial color="#e0faff" transparent opacity={0.95} toneMapped={false} blending={THREE.AdditiveBlending} depthWrite={false} />
      </instancedMesh>

      {/* Nœuds */}
      {items.map((item, i) => (
        <group key={item.id} ref={(el) => { nodeGroups.current[i] = el }}>
          <mesh>
            <sphereGeometry args={[0.21, 20, 16]} />
            <meshStandardMaterial
              ref={(el) => { nodeMeshes.current[i] = el }}
              color="#10101c"
              emissive={new THREE.Color(item.color || CYAN)}
              emissiveIntensity={0.3}
              roughness={0.3}
              metalness={0.2}
            />
          </mesh>
          {/* Coque additive + anneau orbital miniature */}
          <mesh scale={1.55}>
            <sphereGeometry args={[0.21, 16, 12]} />
            <meshBasicMaterial ref={(el) => { shellMeshes.current[i] = el }} color={item.color || CYAN} transparent opacity={0.12} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.BackSide} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.42, 0]}>
            <ringGeometry args={[0.3, 0.34, 32]} />
            <meshBasicMaterial color={item.color || CYAN} transparent opacity={0.3} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
          </mesh>
          {/* Ancre du label DOM */}
          <group ref={(el) => registerAnchor(item.id, el)} position={[0, 0.62, 0]} />
        </group>
      ))}
    </>
  )
}

// ── Poussière ambiante ───────────────────────────────────────────────────────

function Dust() {
  const ref = useRef<THREE.Points>(null)
  const geo = useMemo(() => {
    const rnd = mulberry(5)
    const arr = new Float32Array(240 * 3)
    for (let i = 0; i < 240; i++) {
      arr[i * 3] = (rnd() - 0.5) * 20
      arr[i * 3 + 1] = (rnd() - 0.5) * 12
      arr[i * 3 + 2] = (rnd() - 0.5) * 12
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3))
    return g
  }, [])
  useFrame((state, delta) => {
    if (ref.current) {
      ref.current.rotation.y += delta * 0.018
      ref.current.position.y = Math.sin(state.clock.elapsedTime * 0.2) * 0.3
    }
  })
  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial color={CYAN} size={0.032} transparent opacity={0.28} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  )
}

// ── Projection des labels (DOM overlay, sans portal React) ───────────────────

function LabelSync({ anchors }: { anchors: React.RefObject<Map<string, THREE.Object3D>> }) {
  const { camera, size } = useThree()
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const map = anchors.current
    if (!map) return
    for (const [id, obj] of map) {
      const el = document.getElementById(`jarvis-label-${id}`)
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

// ── Scène complète ───────────────────────────────────────────────────────────

const MAX_NODES = 9

export function JarvisCanvas({ className }: { className?: string }) {
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

  const { nexus, nodes } = useMemo(() => {
    const nexusItem: BrainActivityItem =
      brainActivity['nexus'] ?? {
        id: 'nexus',
        name: 'NEXUS',
        emoji: '🟣',
        color: '#a78bfa',
        role: 'Cerveau central',
        status: 'idle',
        thought: '',
        at: 0,
      }
    const nodeItems: BrainActivityItem[] = agents
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
      .slice(0, MAX_NODES)
    return { nexus: nexusItem, nodes: nodeItems }
  }, [agents, brainActivity])

  const hiddenCount = Math.max(0, agents.filter((a) => a.enabled).length - MAX_NODES)
  const anchorMap = useRef<Map<string, THREE.Object3D>>(new Map())
  const registerAnchor = useCallback((id: string, o: THREE.Object3D | null) => {
    if (o) anchorMap.current.set(id, o)
    else anchorMap.current.delete(id)
  }, [])

  const labels = useMemo(() => [nexus, ...nodes], [nexus, nodes])
  const activeCount = labels.filter((l) => l.status !== 'idle').length

  return (
    <div className={cn('relative h-full w-full overflow-hidden', className)}>
      {/* Fond spatial Jarvis */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 75% 55% at 50% 42%, rgba(34,211,238,0.13), transparent 68%), radial-gradient(ellipse 60% 45% at 18% 78%, rgba(139,92,246,0.12), transparent 70%), radial-gradient(ellipse 50% 40% at 85% 72%, rgba(103,232,249,0.07), transparent 70%)',
        }}
      />
      <Canvas
        camera={{ position: [0, 1.9, isNarrow ? 12.5 : 11], fov: 44 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: true }}
        style={{ position: 'absolute', inset: 0 }}
      >
        <ambientLight intensity={0.5} />
        <directionalLight position={[4, 6, 4]} intensity={1.05} color="#e0f7ff" />
        <directionalLight position={[-5, -2, -4]} intensity={0.45} color="#8b5cf6" />
        <Dust />
        <HoloBrain items={labels} />
        {nodes.length > 0 && <AgentNetwork key={nodes.length} items={nodes} registerAnchor={registerAnchor} />}
        {/* Ancre du label central */}
        <Anchor id="nexus" registerAnchor={registerAnchor} position={[0, 3.1, 0]} />
        <LabelSync anchors={anchorMap} />
        <OrbitControls
          enablePan={false}
          enableZoom
          minDistance={6}
          maxDistance={20}
          maxPolarAngle={Math.PI / 1.75}
          autoRotate
          autoRotateSpeed={0.38}
          target={[0, 0.1, 0]}
        />
      </Canvas>

      {/* Labels projetés */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {labels.map((b) => (
          <div
            key={`label-${b.id}`}
            id={`jarvis-label-${b.id}`}
            className={cn('absolute left-0 top-0 w-52 will-change-transform', b.id !== 'nexus' && 'w-44')}
            style={{ transform: 'translate(-9999px, -9999px)' }}
          >
            <div
              className={cn(
                'rounded-xl border px-2.5 py-1.5 shadow-xl backdrop-blur-md',
                b.id === 'nexus' ? 'border-cyan-300/40 bg-black/75' : 'border-white/10 bg-black/70'
              )}
            >
              <p className="flex items-center gap-1.5 text-[12px] font-bold leading-none text-white">
                <span>{b.emoji}</span>
                <span className="truncate">{b.name}</span>
                <span
                  className={cn(
                    'ml-auto inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                    b.status === 'speaking' ? 'animate-pulse' : b.status === 'thinking' ? 'animate-ping' : 'opacity-40'
                  )}
                  style={{ backgroundColor: b.id === 'nexus' ? CYAN : b.color || '#a78bfa' }}
                />
              </p>
              <p className={cn('mt-0.5 text-[9px] uppercase tracking-wider', b.id === 'nexus' ? 'text-cyan-300/70' : 'text-white/50')}>
                {b.id === 'nexus' ? 'cerveau central' : b.role || 'agent'}
              </p>
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
                      : b.id === 'nexus'
                        ? 'en veille — synapses au repos'
                        : 'en veille — lien au repos'}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* HUD haute */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between px-4 pt-3">
        <div className="rounded-lg border border-cyan-300/25 bg-black/55 px-3 py-1.5 backdrop-blur-md">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-300">Nexus · Neural Link</p>
          <p className="mt-0.5 text-[10px] text-white/60">
            {nodes.length} agent{nodes.length > 1 ? 's' : ''} relié{nodes.length > 1 ? 's' : ''}
            {activeCount > 1 ? ` · ${activeCount - 1} actif${activeCount - 1 > 1 ? 's' : ''}` : ' · tous en veille'}
            {hiddenCount > 0 ? ` · +${hiddenCount} hors orbite` : ''}
          </p>
        </div>
      </div>

      {/* Légende basse */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-gradient-to-t from-background/85 to-transparent px-4 pb-3 pt-8 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-cyan-300" /> cerveau central (réflexion + parole de NEXUS)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 animate-ping rounded-full bg-amber-300" /> impulsions = pensées qui voyagent
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-violet-400" /> nœuds = tes agents en orbite
        </span>
        <span className="hidden sm:inline">— glisse pour tourner, molette pour zoomer</span>
      </div>
    </div>
  )
}

/** Ancre simple pour le label central (groupe positionné). */
function Anchor({
  id,
  registerAnchor,
  position,
}: {
  id: string
  registerAnchor: (id: string, o: THREE.Object3D | null) => void
  position: [number, number, number]
}) {
  return <group ref={(el) => registerAnchor(id, el)} position={position} />
}

// ── Vue page complète (AppShell) ─────────────────────────────────────────────

export function JarvisPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/70 bg-card/50 px-4 py-3 md:px-6">
        <div>
          <h1 className="text-lg font-bold text-foreground">🧠 Cerveau Jarvis</h1>
          <p className="text-xs text-muted-foreground">
            UN cerveau central unique et animé, relié à chaque agent par des liens d&apos;énergie : les impulsions
            voyagent en direct quand un agent réfléchit ou parle — façon J.A.R.V.I.S., 100 % local.
          </p>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <JarvisCanvas />
      </div>
    </div>
  )
}
