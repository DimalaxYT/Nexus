// ─── NEXUS Brain — Constructeur de scènes 3D procédural (local) ───────────────
// Remplace la génération LLM : détection du thème + composition algorithmique
// (usines d'objets par thème, placement déterministe, palettes cohérentes).
// Réutilise les 5 templates officiels quand le thème correspond exactement.

import type { LightingPreset, PrimitiveType, SceneKeyframe, SceneObject, SceneSpec } from '@/lib/nexus-types'
import { SCENE_TEMPLATES } from '@/lib/scene-presets'
import { hashString, mulberry32, normalize } from './text'

type RNG = () => number

let idCounter = 0
function obj(
  name: string,
  type: PrimitiveType,
  position: [number, number, number],
  scale: [number, number, number],
  color: string,
  extra: Partial<SceneObject> = {}
): SceneObject {
  idCounter++
  return {
    id: `gen-${Date.now().toString(36)}-${idCounter}`,
    name,
    type,
    position,
    rotation: [0, 0, 0],
    scale,
    color,
    metalness: 0.2,
    roughness: 0.5,
    opacity: 1,
    emissive: '#000000',
    emissiveIntensity: 0,
    visible: true,
    locked: false,
    segments: 32,
    ...extra,
  }
}

const between = (rng: RNG, a: number, b: number) => a + rng() * (b - a)
const intBetween = (rng: RNG, a: number, b: number) => Math.floor(between(rng, a, b + 1))

interface ThemeSpec {
  id: string
  keywords: RegExp
  label: string
  background: string
  groundColor: string
  lighting: LightingPreset
  build: (rng: RNG) => SceneObject[]
}

// ── Usines d'objets réutilisables ─────────────────────────────────────────────

function arbre(rng: RNG, x: number, z: number, scale = 1): SceneObject[] {
  const h = between(rng, 1.6, 3) * scale
  const trunk = obj('Tronc', 'cylinder', [x, h * 0.42, z], [0.18 * scale, h * 0.42, 0.18 * scale], '#8a5a2b')
  const feuillage = obj(
    'Feuillage',
    rng() > 0.5 ? 'sphere' : 'icosahedron',
    [x, h * 0.95, z],
    [h * 0.42, h * 0.38, h * 0.42],
    greenish(rng)
  )
  return [trunk, feuillage]
}

function greenish(rng: RNG): string {
  const g = Math.floor(120 + rng() * 60)
  const r = Math.floor(20 + rng() * 40)
  const b = Math.floor(30 + rng() * 40)
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

function immeuble(rng: RNG, x: number, z: number, neonA: string, neonB: string): SceneObject {
  const h = between(rng, 2.5, 8)
  const accent = rng() > 0.5 ? neonA : neonB
  return obj(
    'Immeuble',
    'box',
    [x, h / 2, z],
    [between(rng, 1.2, 2.2), h, between(rng, 1.2, 2.2)],
    rng() > 0.5 ? '#18181b' : '#1e1b3a',
    { metalness: 0.5, roughness: 0.35, emissive: accent, emissiveIntensity: between(rng, 0.25, 0.6) }
  )
}

function rocher(rng: RNG, x: number, z: number, scale = 1): SceneObject {
  const types: PrimitiveType[] = ['dodecahedron', 'icosahedron', 'octahedron']
  const s = between(rng, 0.3, 0.9) * scale
  return obj(
    'Rocher',
    types[intBetween(rng, 0, types.length - 1)],
    [x, s * 0.6, z],
    [s, s * between(rng, 0.7, 1.1), s],
    `#${Math.floor(110 + rng() * 40).toString(16).padStart(2, '0')}${Math.floor(105 + rng() * 40).toString(16).padStart(2, '0')}${Math.floor(115 + rng() * 40).toString(16).padStart(2, '0')}`,
    { rotation: [between(rng, 0, 0.4), between(rng, 0, 3), between(rng, -0.2, 0.2)], roughness: 0.9 }
  )
}

function nuage(rng: RNG, y = 7): SceneObject {
  return obj('Nuage', 'sphere', [between(rng, -8, 8), between(rng, y - 1, y + 2), between(rng, -8, 8)], [between(rng, 1, 2), between(rng, 0.5, 0.9), between(rng, 1, 2)], '#ffffff', { opacity: 0.75, roughness: 1 })
}

function lampe(rng: RNG, x: number, z: number, couleur: string): SceneObject[] {
  return [
    obj('Poteau', 'cylinder', [x, 1.5, z], [0.08, 3, 0.08], '#3f3f46'),
    obj('Lampe', 'sphere', [x, 3.2, z], [0.35, 0.35, 0.35], couleur, { emissive: couleur, emissiveIntensity: 2 }),
  ]
}

// ── Animations automatiques (clés générateurs) ───────────────────────────────

function key(t: number, position: [number, number, number], rotation: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1]): SceneKeyframe {
  return { t, position, rotation, scale }
}

/** Attache des clés à un objet (immuable). */
function withKeys(o: SceneObject, keyframes: SceneKeyframe[]): SceneObject {
  return { ...o, keyframes }
}

const baseRot = (o: SceneObject): [number, number, number] => [...o.rotation] as [number, number, number]
const baseScale = (o: SceneObject): [number, number, number] => [...o.scale] as [number, number, number]

/** Flottement vertical (lévitation, véhicules volants). */
function bobKeys(o: SceneObject, dy: number, cycles = 2): SceneKeyframe[] {
  const p = o.position
  const steps = cycles * 2
  const keys: SceneKeyframe[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const up = i % 2 === 1
    keys.push(key(t, [p[0], p[1] + (up ? dy : 0), p[2]], baseRot(o), baseScale(o)))
  }
  return keys
}

/** Rotation continue autour d'un axe (anneaux, drapeaux, pièces). */
function spinKeys(o: SceneObject, axis: 0 | 1 | 2 = 1, turns = 1, steps = 8): SceneKeyframe[] {
  const keys: SceneKeyframe[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const rot = baseRot(o)
    rot[axis] = o.rotation[axis] + t * turns * Math.PI * 2
    keys.push(key(t, o.position, rot, baseScale(o)))
  }
  return keys
}

/** Orbite circulaire autour d'un centre (lunes, oiseaux). */
function orbitKeys(o: SceneObject, center: [number, number], radius: number, y: number, angle0 = 0, steps = 8): SceneKeyframe[] {
  const keys: SceneKeyframe[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const a = angle0 + t * Math.PI * 2
    keys.push(key(t, [center[0] + Math.cos(a) * radius, y, center[1] + Math.sin(a) * radius], baseRot(o), baseScale(o)))
  }
  return keys
}

/** Aller-retour horizontal (poissons, voitures) avec demi-tour. */
function patrolKeys(o: SceneObject, dx: number, dz = 0): SceneKeyframe[] {
  const p = o.position
  const target: [number, number, number] = [p[0] + dx, p[1], p[2] + dz]
  const rot = baseRot(o)
  const turned: [number, number, number] = [rot[0], rot[1] + Math.PI, rot[2]]
  return [
    key(0, p, rot, baseScale(o)),
    key(0.42, target, rot, baseScale(o)),
    key(0.5, target, turned, baseScale(o)),
    key(0.92, p, turned, baseScale(o)),
    key(1, p, rot, baseScale(o)),
  ]
}

/** Montée avec dissolution (bulles, fumée, braises). */
function riseKeys(o: SceneObject, dy: number, wobble = 0.4): SceneKeyframe[] {
  const p = o.position
  const s = baseScale(o)
  const small: [number, number, number] = [s[0] * 0.25, s[1] * 0.25, s[2] * 0.25]
  const end: [number, number, number] = [s[0] * 0.03, s[1] * 0.03, s[2] * 0.03]
  const top: [number, number, number] = [p[0] + wobble, p[1] + dy, p[2] + wobble * 0.5]
  return [
    key(0, p, baseRot(o), small),
    key(0.5, [p[0] + wobble * 0.4, p[1] + dy * 0.55, p[2]], baseRot(o), s),
    key(0.93, top, baseRot(o), [s[0] * 0.7, s[1] * 0.7, s[2] * 0.7]),
    key(1, top, baseRot(o), end),
  ]
}

/** Pulsation d'échelle (feux, champignons lumineux, fontaines). */
function pulseKeys(o: SceneObject, factor = 1.2, cycles = 2): SceneKeyframe[] {
  const p = o.position
  const s = baseScale(o)
  const big: [number, number, number] = [s[0] * factor, s[1] * factor, s[2] * factor]
  const keys: SceneKeyframe[] = []
  const steps = cycles * 2
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    keys.push(key(t, p, baseRot(o), i % 2 === 1 ? big : s))
  }
  return keys
}

/** Dérive lente (nuages). */
function driftKeys(o: SceneObject, dx: number): SceneKeyframe[] {
  const p = o.position
  return [
    key(0, [p[0] - dx / 2, p[1], p[2]], baseRot(o), baseScale(o)),
    key(1, [p[0] + dx / 2, p[1], p[2]], baseRot(o), baseScale(o)),
  ]
}

// ── Thèmes ────────────────────────────────────────────────────────────────────

const THEMES: ThemeSpec[] = [
  {
    id: 'city',
    keywords: /ville|city|urbain|gratte.?ciel|metropole|immeuble|cyberpunk|downtown/,
    label: 'ville',
    background: '#0a0414',
    groundColor: '#12101f',
    lighting: 'neon',
    build: (rng) => {
      const out: SceneObject[] = [
        obj('Route', 'box', [0, 0.05, 0], [20, 0.1, 20], '#17171c', { roughness: 0.85 }),
      ]
      const neons = ['#ec4899', '#22d3ee', '#a855f7', '#f59e0b']
      for (let i = 0; i < 14; i++) {
        const x = between(rng, -9, 9)
        const z = between(rng, -9, 9)
        if (Math.abs(x) < 1.6 && Math.abs(z) < 1.6) continue
        out.push(immeuble(rng, x, z, neons[intBetween(rng, 0, neons.length - 1)], neons[intBetween(rng, 0, neons.length - 1)]))
      }
      // Tour centrale + antenne
      out.push(obj('Tour centrale', 'box', [0, 5, 0], [2.6, 10, 2.6], '#1e1b4b', { emissive: '#7c3aed', emissiveIntensity: 0.5, metalness: 0.6 }))
      out.push(obj('Antenne', 'cylinder', [0, 10.7, 0], [0.07, 1.4, 0.07], '#ec4899', { emissive: '#ec4899', emissiveIntensity: 2 }))
      // Anneau holographique en rotation continue
      const ring = obj('Anneau holo', 'torus', [0, 6.5, 0], [3.2, 3.2, 3.2], '#22d3ee', { rotation: [1.5708, 0, 0], emissive: '#22d3ee', emissiveIntensity: 1.2, opacity: 0.7 })
      out.push(withKeys(ring, spinKeys(ring, 2, 1, 10)))
      // Lampadaires
      out.push(...lampe(rng, -3, 3, '#22d3ee'))
      out.push(...lampe(rng, 3, -3, '#ec4899'))
      // Voiture volante (flotte doucement)
      const veh = obj('Véhicule volant', 'capsule', [between(rng, -6, 6), 2.4, between(rng, -6, 6)], [0.5, 0.9, 0.5], '#f43f5e', { rotation: [0, between(rng, 0, 3), 0], emissive: '#f43f5e', emissiveIntensity: 0.8 })
      out.push(withKeys(veh, bobKeys(veh, 0.5, 3)))
      return out
    },
  },
  {
    id: 'forest',
    keywords: /foret|for[eê]t|jungle|bois|sylve|arbre/,
    label: 'forêt',
    background: '#0c1a12',
    groundColor: '#123324',
    lighting: 'day',
    build: (rng) => {
      const out: SceneObject[] = [obj('Clairière', 'cylinder', [0, 0.06, 0], [9, 0.12, 9], '#2d5a3d', { roughness: 0.95 })]
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2 + rng()
        const radius = between(rng, 3.4, 7.5)
        out.push(...arbre(rng, Math.cos(angle) * radius, Math.sin(angle) * radius, between(rng, 0.9, 1.5)))
      }
      out.push(...arbre(rng, 0, 0, 1.8))
      const champ1 = obj('Champignon', 'capsule', [1.4, 0.35, 1.8], [0.3, 0.5, 0.3], '#ec4899', { emissive: '#ec4899', emissiveIntensity: 0.7 })
      out.push(withKeys(champ1, pulseKeys(champ1, 1.25, 3)))
      const champ2 = obj('Champignon 2', 'capsule', [1.9, 0.28, 1.4], [0.22, 0.4, 0.22], '#f472b6', { emissive: '#f472b6', emissiveIntensity: 0.7 })
      out.push(withKeys(champ2, pulseKeys(champ2, 1.3, 2)))
      out.push(rocher(rng, -2.4, 2, 0.8))
      out.push(rocher(rng, 2.8, -2.2, 0.6))
      out.push(nuage(rng, 7))
      out.push(nuage(rng, 8.5))
      return out
    },
  },
  {
    id: 'island',
    keywords: /ile flottante|\bile\b|flottant|skyblock|archipel|obby volant/,
    label: 'île flottante',
    background: '#1a1033',
    groundColor: '#18181b',
    lighting: 'sunset',
    build: (rng) => {
      const out: SceneObject[] = [
        obj('Socle roche', 'dodecahedron', [0, -1.2, 0], [4, 2.2, 4], '#6b5b73'),
        obj('Terre', 'cylinder', [0, 0.35, 0], [4.4, 0.7, 4.4], '#4a7c4e'),
        obj('Maison corps', 'box', [0, 1.3, 0], [1.8, 1.6, 1.8], '#e8dcc8'),
        obj('Toit', 'cone', [0, 2.65, 0], [1.7, 1.3, 1.7], '#b91c1c'),
        obj('Cheminée', 'box', [0.6, 2.3, 0.6], [0.25, 0.9, 0.25], '#78716c'),
        ...arbre(rng, -1.5, 0.8, 1.1),
        ...arbre(rng, 1.6, -0.9, 0.8),
        obj('Lanterne', 'sphere', [2.6, 1.35, 0], [0.18, 0.18, 0.18], '#ffd700', { emissive: '#ffcc00', emissiveIntensity: 1.8 }),
      ]
      for (let i = 0; i < 3; i++) {
        const s = between(rng, 0.5, 0.9)
        const rock = obj('Roche flottante', 'octahedron', [between(rng, -6, 6), between(rng, 1, 3.5), between(rng, -6, 6)], [s, s * 1.3, s], '#7c6f88', { rotation: [between(rng, 0, 0.6), between(rng, 0, 3), 0] })
        out.push(withKeys(rock, [...bobKeys(rock, 0.4, 2), ...spinKeys(rock, 1, 1, 8).slice(1)]))
      }
      out.push(nuage(rng, 4))
      return out
    },
  },
  {
    id: 'space',
    keywords: /espace|spatial|planet|galaxie|cosmos|systeme solaire|fusee|fus[ée]e|etoile/,
    label: 'espace',
    background: '#05010d',
    groundColor: '#0a0618',
    lighting: 'neon',
    build: (rng) => {
      const out: SceneObject[] = []
      // Planète principale + lunes
      out.push(obj('Planète', 'sphere', [0, 4, 0], [2.6, 2.6, 2.6], '#4a67d8', { metalness: 0.1, roughness: 0.65 }))
      out.push(obj('Anneau', 'torus', [0, 4, 0], [4, 4, 4], '#d4af37', { rotation: [1.2, 0.4, 0], opacity: 0.8, emissive: '#d4af37', emissiveIntensity: 0.4 }))
      for (let i = 0; i < 3; i++) {
        const s = between(rng, 0.4, 0.9)
        const moon = obj(`Lune ${i + 1}`, 'sphere', [0, 4, 0], [s, s, s], `hsl(${intBetween(rng, 0, 360)}, 30%, 70%)`)
        out.push(withKeys(moon, orbitKeys(moon, [0, 0], 5 + i * 1.6, between(rng, 2.5, 6.5), rng() * 6.28)))
      }
      // Astéroïdes
      for (let i = 0; i < 6; i++) {
        const s = between(rng, 0.2, 0.55)
        out.push(rocher(rng, between(rng, -8, 8), between(rng, -8, 8), s * 1.4))
      }
      // Fusée
      out.push(obj('Corps de fusée', 'cylinder', [5.5, 1.6, -4], [0.4, 2.2, 0.4], '#e2e8f0', { metalness: 0.7, roughness: 0.25 }))
      out.push(obj('Cône de fusée', 'cone', [5.5, 3.2, -4], [0.42, 0.9, 0.42], '#ef4444', { metalness: 0.5 }))
      const flame = obj('Flamme', 'cone', [5.5, 0.1, -4], [0.3, 0.8, 0.3], '#f59e0b', { rotation: [3.14, 0, 0], emissive: '#f97316', emissiveIntensity: 2 })
      out.push(withKeys(flame, pulseKeys(flame, 1.35, 4)))
      // Étoiles
      for (let i = 0; i < 10; i++) {
        const s = between(rng, 0.06, 0.14)
        out.push(obj('Étoile', 'icosahedron', [between(rng, -9, 9), between(rng, 4, 10), between(rng, -9, 9)], [s, s, s], '#ffffff', { emissive: '#ffffff', emissiveIntensity: 2.5 }))
      }
      return out
    },
  },
  {
    id: 'beach',
    keywords: /plage|beach|mer|ocean|tropical|palmier|lagon/,
    label: 'plage',
    background: '#8fd3f4',
    groundColor: '#e8d5a3',
    lighting: 'day',
    build: (rng) => {
      const out: SceneObject[] = [
        obj('Sable', 'cylinder', [0, 0.05, 0], [10, 0.1, 10], '#f2dfa7', { roughness: 0.95 }),
        obj('Mer', 'cylinder', [6, 0.22, 6], [6.5, 0.25, 6.5], '#0ea5a5', { metalness: 0.55, roughness: 0.15, opacity: 0.9 }),
        obj('Soleil', 'sphere', [-6, 8, -6], [1.6, 1.6, 1.6], '#ffd54a', { emissive: '#ffb700', emissiveIntensity: 1.4 }),
      ]
      for (let i = 0; i < 3; i++) {
        const x = between(rng, -6, -1)
        const z = between(rng, -5, 3)
        out.push(obj('Tronc de palmier', 'cylinder', [x, 1.6, z], [0.18, 3.2, 0.18], '#92603a', { rotation: [0, 0, between(rng, -0.15, 0.15)] }))
        for (let f = 0; f < 5; f++) {
          const angle = (f / 5) * Math.PI * 2
          out.push(obj('Palme', 'box', [x + Math.cos(angle) * 0.9, 3.3, z + Math.sin(angle) * 0.9], [1.8, 0.06, 0.5], '#2f9e44', { rotation: [0, -angle, 0.45] }))
        }
        if (rng() > 0.5) out.push(obj('Noix de coco', 'sphere', [x + 0.2, 3.1, z], [0.2, 0.2, 0.2], '#7a4a21'))
      }
      out.push(obj('Serviette', 'box', [0.5, 0.14, 2], [1, 0.06, 1.8], '#ec4899', { rotation: [0, 0.4, 0] }))
      out.push(obj('Parasol pied', 'cylinder', [-0.8, 1, 1.8], [0.06, 2, 0.06], '#9ca3af'))
      out.push(obj('Parasol', 'cone', [-0.8, 2.2, 1.8], [1.6, 0.6, 1.6], '#f59e0b', { segments: 8 }))
      out.push(rocher(rng, -3.5, -4, 0.7))
      return out
    },
  },
  {
    id: 'castle',
    keywords: /chateau|ch[âa]teau|forter|medieval|m[ée]di[ée]val|royal|donjon/,
    label: 'château médiéval',
    background: '#2b1d3a',
    groundColor: '#2f4030',
    lighting: 'sunset',
    build: (rng) => {
      const out: SceneObject[] = [
        obj('Colline', 'cylinder', [0, 0.2, 0], [11, 0.4, 11], '#3d5a45', { roughness: 0.95 }),
        obj('Mur d\'enceinte', 'box', [0, 1.1, 0], [9, 1.8, 9], '#8b8680', { roughness: 0.85 }),
      ]
      // 4 tours d'angle
      for (const [tx, tz] of [[-4.2, -4.2], [4.2, -4.2], [-4.2, 4.2], [4.2, 4.2]] as const) {
        out.push(obj('Tour', 'cylinder', [tx, 2.4, tz], [0.9, 4.8, 0.9], '#78716c', { roughness: 0.8 }))
        out.push(obj('Toit de tour', 'cone', [tx, 5.4, tz], [1.2, 1.4, 1.2], '#7f1d1d'))
        out.push(obj('Drapeau', 'box', [tx, 6.4, tz], [0.06, 0.8, 0.06], '#57534e'))
        out.push(obj('Étendard', 'box', [tx + 0.25, 6.6, tz], [0.45, 0.3, 0.02], '#dc2626'))
      }
      // Donjon central
      out.push(obj('Donjon', 'box', [0, 3, 0], [2.6, 5, 2.6], '#6b7280', { roughness: 0.75 }))
      out.push(obj('Toit donjon', 'cone', [0, 6.4, 0], [2.4, 1.8, 2.4], '#991b1b'))
      // Porte + pont-levis
      out.push(obj('Porte', 'box', [0, 0.9, 4.55], [1.4, 1.6, 0.2], '#4a2c17'))
      out.push(obj('Chemin', 'box', [0, 0.12, 5.8], [1.6, 0.12, 2.6], '#a16207', { rotation: [-0.08, 0, 0] }))
      // Nature
      for (let i = 0; i < 5; i++) {
        const angle = rng() * Math.PI * 2
        const radius = between(rng, 6, 9)
        out.push(...arbre(rng, Math.cos(angle) * radius, Math.sin(angle) * radius, between(rng, 0.7, 1.1)))
      }
      return out
    },
  },
  {
    id: 'snow',
    keywords: /neige|hiver|arctique|glace|banquise|pingouin/,
    label: 'paysage enneigé',
    background: '#b8d4e8',
    groundColor: '#e8f0f6',
    lighting: 'day',
    build: (rng) => {
      const out: SceneObject[] = [
        obj('Neige', 'cylinder', [0, 0.06, 0], [10, 0.12, 10], '#f4f8fb', { roughness: 0.9 }),
        obj('Montagne 1', 'cone', [-5, 2.6, -5], [5, 5.5, 5], '#dce8f2', { segments: 4, roughness: 0.85 }),
        obj('Montagne 2', 'cone', [4, 3.2, -7], [6, 6.5, 6], '#e4edf5', { segments: 4, roughness: 0.85 }),
        obj('Sapin enneigé', 'cone', [2.5, 1.3, 1.5], [1.2, 2.6, 1.2], '#2d5a3d'),
        obj('Neige sapin', 'cone', [2.5, 2.2, 1.5], [0.8, 0.8, 0.8], '#f4f8fb'),
        obj('Sapin 2', 'cone', [-2.8, 1, 2.2], [0.9, 2, 0.9], '#2d5a3d'),
      ]
      // Igloo
      out.push(obj('Igloo', 'sphere', [0.5, 0.55, -1], [1.3, 0.85, 1.3], '#eaf2f8', { roughness: 0.7 }))
      out.push(obj('Entrée igloo', 'cylinder', [0.5, 0.3, -0.15], [0.4, 0.5, 0.3], '#d7e4ee', { rotation: [1.5708, 0, 0] }))
      // Bonhomme de neige
      out.push(obj('Base bonhomme', 'sphere', [-1.8, 0.45, 0.8], [0.6, 0.6, 0.6], '#ffffff'))
      out.push(obj('Torse bonhomme', 'sphere', [-1.8, 1.15, 0.8], [0.42, 0.42, 0.42], '#ffffff'))
      out.push(obj('Tête bonhomme', 'sphere', [-1.8, 1.7, 0.8], [0.3, 0.3, 0.3], '#ffffff'))
      out.push(obj('Nez bonhomme', 'cone', [-1.8, 1.7, 0.55], [0.07, 0.25, 0.07], '#f97316', { rotation: [1.5708, 0, 0] }))
      // Lumières d'hiver
      out.push(...lampe(rng, 3, -2, '#7dd3fc'))
      for (let i = 0; i < 2; i++) out.push(nuage(rng, 8))
      return out
    },
  },
  {
    id: 'race',
    keywords: /circuit|course|race|kart|voiture|piste/,
    label: 'circuit de course',
    background: '#87b8e0',
    groundColor: '#4a7c4e',
    lighting: 'day',
    build: (rng) => {
      const out: SceneObject[] = [
        obj('Herbe', 'box', [0, 0.05, 0], [22, 0.1, 22], '#4a7c4e', { roughness: 0.95 }),
        obj('Piste', 'box', [0, 0.11, 0], [16, 0.1, 7], '#2f2f35', { roughness: 0.7 }),
      ]
      // Bordures rouge/blanc
      for (let i = 0; i < 8; i++) {
        out.push(obj('Bordure', 'box', [-7 + i * 2, 0.16, 3.7], [1.9, 0.08, 0.5], i % 2 === 0 ? '#dc2626' : '#f5f5f5'))
        out.push(obj('Bordure 2', 'box', [-7 + i * 2, 0.16, -3.7], [1.9, 0.08, 0.5], i % 2 === 0 ? '#f5f5f5' : '#dc2626'))
      }
      // Voitures (roulent le long de la piste)
      const couleurs = ['#ef4444', '#3b82f6', '#f59e0b', '#22c55e']
      for (let i = 0; i < 4; i++) {
        const x = -5.5 + i * 3.4
        const z0 = between(rng, -1.8, 1.8)
        const car = obj(`Voiture ${i + 1}`, 'box', [x, 0.5, z0], [1.1, 0.4, 0.6], couleurs[i], { metalness: 0.6, roughness: 0.3 })
        out.push(withKeys(car, patrolKeys(car, 12)))
        const cabin = obj(`Habitacle ${i + 1}`, 'box', [x - 0.1, 0.85, z0], [0.5, 0.3, 0.5], '#1f2937', { metalness: 0.4 })
        out.push(withKeys(cabin, patrolKeys(cabin, 12)))
      }
      // Ligne d'arrivée + tribune
      out.push(obj('Ligne d\'arrivée', 'box', [7, 0.17, 0], [0.6, 0.02, 7], '#f5f5f5'))
      out.push(obj('Arche gauche', 'cylinder', [7, 1.5, 3.8], [0.1, 3, 0.1], '#71717a'))
      out.push(obj('Arche droite', 'cylinder', [7, 1.5, -3.8], [0.1, 3, 0.1], '#71717a'))
      out.push(obj('Bandeau', 'box', [7, 3.1, 0], [0.4, 0.7, 7.6], '#dc2626', { emissive: '#dc2626', emissiveIntensity: 0.4 }))
      out.push(obj('Tribune', 'box', [-9.5, 1.2, 0], [2.5, 2, 8], '#52525b', { roughness: 0.8 }))
      for (let i = 0; i < 3; i++) out.push(nuage(rng, 8))
      return out
    },
  },
  {
    id: 'baseplate',
    keywords: /baseplate|roblox|plateau|obby|parcours/,
    label: 'baseplate Roblox',
    background: '#9ec7e8',
    groundColor: '#4a7c4e',
    lighting: 'day',
    build: (rng) => {
      const out: SceneObject[] = [
        obj('Base', 'box', [0, 0.25, 0], [24, 0.5, 24], '#6b8f5e', { roughness: 0.9 }),
        obj('Spawn', 'cylinder', [0, 0.55, 0], [2.4, 0.12, 2.4], '#d4af37', { emissive: '#ffd700', emissiveIntensity: 0.35 }),
      ]
      // Parcours d'obby
      const couleurs = ['#7c3aed', '#a855f7', '#ec4899', '#f43f5e', '#f59e0b', '#22c55e']
      for (let i = 0; i < 6; i++) {
        out.push(obj(`Bloc saut ${i + 1}`, 'box', [3 + i * 2.2, 0.75 + i * 0.75, -3 - i * 1.8], [1.5, 1.5, 1.5], couleurs[i]))
      }
      out.push(...arbre(rng, -5, -4, 1.2))
      out.push(...arbre(rng, -7.5, -1.5, 0.9))
      out.push(obj('Muret', 'box', [0, 0.9, 6], [8, 1.8, 0.6], '#9ca3af', { roughness: 0.85 }))
      // Pièce géante qui tourne
      const coin = obj('Pièce géante', 'cylinder', [8, 1.2, -8], [0.3, 1.4, 1.4], '#ffd700', { rotation: [0, 0, 1.5708], emissive: '#ffcc00', emissiveIntensity: 0.8 })
      out.push(withKeys(coin, spinKeys(coin, 2, 1, 10)))
      return out
    },
  },
  {
    id: 'park',
    keywords: /parc|jardin|ville verte|fontaine/,
    label: 'parc public',
    background: '#a3cfe8',
    groundColor: '#4a7c4e',
    lighting: 'day',
    build: (rng) => {
      const out: SceneObject[] = [
        obj('Pelouse', 'cylinder', [0, 0.06, 0], [10, 0.12, 10], '#5a9e5a', { roughness: 0.95 }),
        obj('Allée', 'box', [0, 0.1, 0], [2, 0.08, 18], '#c9b896', { roughness: 0.9 }),
        obj('Fontaine bassin', 'cylinder', [0, 0.4, 0], [2, 0.7, 2], '#94a3b8', { metalness: 0.5, roughness: 0.4 }),
        obj('Banc', 'box', [1.6, 0.45, 3], [0.5, 0.1, 1.6], '#8a5a2b'),
        obj('Banc 2', 'box', [-1.6, 0.45, -3], [0.5, 0.1, 1.6], '#8a5a2b'),
      ]
      // Jet d'eau qui pulse
      const jet = obj('Jet d\'eau', 'cone', [0, 1.4, 0], [0.5, 1.4, 0.5], '#7dd3fc', { opacity: 0.7, emissive: '#7dd3fc', emissiveIntensity: 0.4 })
      out.push(withKeys(jet, pulseKeys(jet, 1.3, 4)))
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2 + rng()
        const radius = between(rng, 4.5, 8)
        out.push(...arbre(rng, Math.cos(angle) * radius, Math.sin(angle) * radius, between(rng, 0.8, 1.3)))
      }
      out.push(rocher(rng, 3, -4, 0.6))
      for (let i = 0; i < 2; i++) out.push(nuage(rng, 7.5))
      return out
    },
  },
  {
    id: 'underwater',
    keywords: /sous.?marin|underwater|ocean|fond marin|corail|recif|r[ée]cif|poisson|aquarium|abysse|plong[ée]e/,
    label: 'fonds marins',
    background: '#04395e',
    groundColor: '#0a5a80',
    lighting: 'day',
    build: (rng) => {
      const out: SceneObject[] = [
        obj('Sable', 'cylinder', [0, 0.05, 0], [11, 0.1, 11], '#c9b57e', { roughness: 0.95 }),
        obj('Roche 1', 'dodecahedron', [-3.2, 0.5, -2.5], [1, 0.8, 1], '#3a6b7d', { roughness: 0.9 }),
        obj('Roche 2', 'dodecahedron', [4, 0.4, 3], [0.8, 0.6, 0.8], '#3a6b7d', { roughness: 0.9 }),
      ]
      // Coraux lumineux
      const coralColors = ['#ff6b9d', '#ff8c42', '#c084fc', '#22d3ee']
      for (let i = 0; i < 7; i++) {
        const x = between(rng, -8, 8)
        const z = between(rng, -8, 8)
        if (Math.abs(x) < 2 && Math.abs(z) < 2) continue
        const col = coralColors[intBetween(rng, 0, coralColors.length - 1)]
        const coral = obj(`Corail ${i + 1}`, rng() > 0.5 ? 'icosahedron' : 'octahedron', [x, between(rng, 0.3, 0.7), z], [between(rng, 0.25, 0.6), between(rng, 0.35, 0.8), between(rng, 0.25, 0.6)], col, { emissive: col, emissiveIntensity: 0.55, roughness: 0.6 })
        out.push(withKeys(coral, pulseKeys(coral, 1.18, 2)))
      }
      // Algues qui se balancent doucement
      for (let i = 0; i < 5; i++) {
        const x = between(rng, -7, 7)
        const z = between(rng, -7, 7)
        const h = between(rng, 1.4, 2.6)
        const alga = obj(`Algue ${i + 1}`, 'cylinder', [x, h / 2, z], [0.08, h / 2, 0.08], '#2f9e68', { rotation: [between(rng, -0.2, 0.2), 0, between(rng, -0.2, 0.2)], roughness: 0.8 })
        out.push(withKeys(alga, bobKeys(alga, 0.22, 3)))
      }
      // Banc de poissons (aller-retour)
      for (let i = 0; i < 4; i++) {
        const y = between(rng, 1.2, 3.6)
        const z = between(rng, -4, 4)
        const col = ['#f59e0b', '#f97316', '#facc15', '#fb7185'][i]
        const fish = obj(`Poisson ${i + 1}`, 'capsule', [-6, y, z], [0.22, 0.45, 0.22], col, { rotation: [0, 0, 1.5708], metalness: 0.3, roughness: 0.35 })
        out.push(withKeys(fish, patrolKeys(fish, 12)))
        const tail = obj(`Queue ${i + 1}`, 'cone', [-6.45, y, z], [0.14, 0.3, 0.14], col, { rotation: [0, 0, 1.5708] })
        out.push(withKeys(tail, patrolKeys(tail, 12)))
      }
      // Bulles qui remontent
      for (let i = 0; i < 6; i++) {
        const bubble = obj(`Bulle ${i + 1}`, 'sphere', [between(rng, -6, 6), 0.4, between(rng, -6, 6)], [between(rng, 0.1, 0.24), between(rng, 0.1, 0.24), between(rng, 0.1, 0.24)], '#bae6fd', { opacity: 0.55, emissive: '#7dd3fc', emissiveIntensity: 0.4 })
        out.push(withKeys(bubble, riseKeys(bubble, between(rng, 4, 6.5), 0.5)))
      }
      // Coffre au trésor
      out.push(obj('Coffre', 'box', [1.6, 0.32, -1.4], [0.7, 0.5, 0.55], '#8a5a2b', { roughness: 0.7 }))
      out.push(obj('Or', 'sphere', [1.6, 0.62, -1.4], [0.22, 0.16, 0.22], '#ffd700', { emissive: '#ffcc00', emissiveIntensity: 0.9, metalness: 0.8, roughness: 0.2 }))
      return out
    },
  },
  {
    id: 'desert',
    keywords: /desert|d[ée]sert|dune|sable|sahara|pyramide|oasis|cactus|mirage/,
    label: 'désert',
    background: '#f7d9a8',
    groundColor: '#e0b36a',
    lighting: 'sunset',
    build: (rng) => {
      const out: SceneObject[] = [
        obj('Sable', 'cylinder', [0, 0.05, 0], [12, 0.1, 12], '#eec87f', { roughness: 0.95 }),
        obj('Soleil', 'sphere', [-5, 6.5, -7], [1.8, 1.8, 1.8], '#ffb347', { emissive: '#ff9a3c', emissiveIntensity: 1.3 }),
      ]
      // Dunes (sphères aplaties)
      for (let i = 0; i < 8; i++) {
        const x = between(rng, -10, 10)
        const z = between(rng, -10, 10)
        if (Math.abs(x) < 3 && Math.abs(z) < 3) continue
        out.push(obj(`Dune ${i + 1}`, 'sphere', [x, -0.4, z], [between(rng, 2, 4), between(rng, 0.7, 1.3), between(rng, 2, 4)], '#e3b269', { roughness: 0.95 }))
      }
      // Pyramides
      out.push(obj('Grande pyramide', 'cone', [-4, 1.6, -5], [3.4, 3.2, 3.4], '#d8a854', { segments: 4, rotation: [0, 0.7854, 0], roughness: 0.8 }))
      out.push(obj('Pyramide 2', 'cone', [-6.4, 1, -3.4], [2, 2, 2], '#c9963f', { segments: 4, rotation: [0, 0.7854, 0], roughness: 0.8 }))
      // Oasis
      out.push(obj('Eau de l\'oasis', 'cylinder', [2.6, 0.12, 2.2], [1.6, 0.12, 1.6], '#38bdf8', { metalness: 0.5, roughness: 0.15, opacity: 0.92 }))
      const palmX = 3.6
      const palmZ = 3
      out.push(obj('Palmier tronc', 'cylinder', [palmX, 1.5, palmZ], [0.14, 3, 0.14], '#92603a', { rotation: [0, 0, 0.08] }))
      for (let f = 0; f < 5; f++) {
        const angle = (f / 5) * Math.PI * 2
        out.push(obj('Palme', 'box', [palmX + Math.cos(angle) * 0.8, 3.1, palmZ + Math.sin(angle) * 0.8], [1.5, 0.05, 0.4], '#2f9e44', { rotation: [0, -angle, 0.5] }))
      }
      // Cactus
      for (let i = 0; i < 3; i++) {
        const cx = between(rng, -8, 8)
        const cz = between(rng, -8, 8)
        if (Math.abs(cx) < 2 && Math.abs(cz) < 2) continue
        const ch = between(rng, 1.2, 2)
        out.push(obj(`Cactus ${i + 1}`, 'cylinder', [cx, ch / 2, cz], [0.18, ch / 2, 0.18], '#3d7a44', { roughness: 0.8 }))
        if (rng() > 0.4) out.push(obj('Bras de cactus', 'cylinder', [cx + 0.4, ch * 0.62, cz], [0.12, 0.35, 0.12], '#3d7a44', { rotation: [0, 0, -0.9] }))
      }
      // Squelette décoratif ? Non — roches
      out.push(rocher(rng, -2, 4, 0.5))
      return out
    },
  },
  {
    id: 'volcano',
    keywords: /volcan|volcano|lave|eruption|[ée]ruption|magma|braise|infern/,
    label: 'volcan en activité',
    background: '#180b0b',
    groundColor: '#2a1616',
    lighting: 'sunset',
    build: (rng) => {
      const out: SceneObject[] = [
        obj('Terre brûlée', 'cylinder', [0, 0.05, 0], [11, 0.1, 11], '#331b17', { roughness: 0.9 }),
        obj('Volcan', 'cone', [0, 2.6, -1], [4.2, 5.2, 4.2], '#4a3230', { segments: 8, roughness: 0.85 }),
        obj('Cratère', 'cylinder', [0, 5.15, -1], [1.1, 0.35, 1.1], '#f97316', { emissive: '#f97316', emissiveIntensity: 1.6 }),
      ]
      // Coulées de lave
      for (let i = 0; i < 3; i++) {
        const angle = rng() * Math.PI * 2
        const lx = Math.cos(angle) * 2.6
        const lz = -1 + Math.sin(angle) * 2.6
        out.push(obj(`Coulée ${i + 1}`, 'box', [lx, 1.4, lz], [0.4, 2.6, 0.4], '#f97316', { rotation: [Math.sin(angle) * 0.5, 0, -Math.cos(angle) * 0.5], emissive: '#ea580c', emissiveIntensity: 1.2, roughness: 0.4 }))
      }
      // Lac de lave pulsant
      const lava = obj('Lac de lave', 'cylinder', [3.4, 0.14, 3.2], [1.8, 0.12, 1.8], '#ef4444', { emissive: '#ef4444', emissiveIntensity: 1.5 })
      out.push(withKeys(lava, pulseKeys(lava, 1.08, 4)))
      // Fumée qui monte
      for (let i = 0; i < 4; i++) {
        const smoke = obj(`Fumée ${i + 1}`, 'sphere', [between(rng, -0.6, 0.6), 5.8, -1 + between(rng, -0.6, 0.6)], [between(rng, 0.4, 0.7), between(rng, 0.4, 0.7), between(rng, 0.4, 0.7)], '#6b7280', { opacity: 0.45, roughness: 1 })
        out.push(withKeys(smoke, riseKeys(smoke, between(rng, 2.5, 4), 0.7)))
      }
      // Braises qui s'envolent
      for (let i = 0; i < 5; i++) {
        const ember = obj(`Braise ${i + 1}`, 'sphere', [between(rng, -1.5, 1.5), between(rng, 1, 3), between(rng, -3, 1.5)], [0.09, 0.09, 0.09], '#fbbf24', { emissive: '#f59e0b', emissiveIntensity: 2.2 })
        out.push(withKeys(ember, riseKeys(ember, between(rng, 3, 5), 0.3)))
      }
      // Rochers brûlants
      for (let i = 0; i < 4; i++) {
        const rx = between(rng, -8, 8)
        const rz = between(rng, -8, 8)
        if (Math.abs(rx) < 3.5 && Math.abs(rz + 1) < 3.5) continue
        out.push(obj(`Rocher ${i + 1}`, 'dodecahedron', [rx, 0.4, rz], [between(rng, 0.4, 0.9), between(rng, 0.3, 0.6), between(rng, 0.4, 0.9)], '#3f2a28', { rotation: [between(rng, 0, 0.5), between(rng, 0, 3), 0], emissive: '#7c2d12', emissiveIntensity: 0.25, roughness: 0.9 }))
      }
      return out
    },
  },
  {
    id: 'mountain',
    keywords: /montagne|alpin|sommet|alpes|himalaya|pic|refuge|lac de montagne/,
    label: 'montagnes et lac',
    background: '#a8cfE8',
    groundColor: '#4a7c4e',
    lighting: 'day',
    build: (rng) => {
      const out: SceneObject[] = [
        obj('Prairie', 'cylinder', [0, 0.06, 0], [11, 0.12, 11], '#5a9e5a', { roughness: 0.95 }),
        obj('Lac de montagne', 'cylinder', [3.2, 0.14, 2.8], [2.6, 0.12, 2.6], '#38bdf8', { metalness: 0.55, roughness: 0.12, opacity: 0.94 }),
      ]
      // Pics enneigés
      const peaks: [number, number, number][] = [[-4.5, -4, 5.5], [-1, -6.5, 7], [3, -5.5, 4.5], [-6.5, -1, 4]]
      peaks.forEach(([px, pz, ph], i) => {
        out.push(obj(`Pic ${i + 1}`, 'cone', [px, ph / 2, pz], [ph * 0.55, ph, ph * 0.55], '#6b7280', { segments: 5, roughness: 0.85 }))
        out.push(obj(`Neige du pic ${i + 1}`, 'cone', [px, ph * 0.82, pz], [ph * 0.18, ph * 0.36, ph * 0.18], '#f4f8fb', { segments: 5, roughness: 0.8 }))
      })
      // Sapins
      for (let i = 0; i < 7; i++) {
        const angle = (i / 7) * Math.PI * 2 + rng()
        const radius = between(rng, 4.5, 8.5)
        const x = Math.cos(angle) * radius
        const z = Math.sin(angle) * radius
        if (z > -2 && Math.abs(x) < 5 && z < 4.5 && Math.abs(x - 3.2) < 3.4 && Math.abs(z - 2.8) < 3.4) continue
        const th = between(rng, 1.4, 2.4)
        out.push(obj(`Sapin ${i + 1}`, 'cone', [x, th / 2 + 0.1, z], [th * 0.42, th, th * 0.42], '#2d5a3d', { segments: 7 }))
        out.push(obj(`Tronc ${i + 1}`, 'cylinder', [x, 0.18, z], [0.09, 0.2, 0.09], '#6b4226'))
      }
      // Refuge d'alpage
      out.push(obj('Refuge', 'box', [-2, 0.75, 2.6], [1.5, 1.1, 1.2], '#8a5a2b', { roughness: 0.8 }))
      out.push(obj('Toit du refuge', 'cone', [-2, 1.7, 2.6], [1.35, 0.8, 1.1], '#7f1d1d', { segments: 4, rotation: [0, 0.7854, 0] }))
      // Aigle qui tournoie
      const eagle = obj('Aigle', 'cone', [0, 6, 0], [0.16, 0.5, 0.16], '#3f3f46', { rotation: [1.5708, 0, 0] })
      out.push(withKeys(eagle, orbitKeys(eagle, [0, 0], 5.5, 6, rng() * 6.28)))
      for (let i = 0; i < 2; i++) out.push(nuage(rng, 8.5))
      return out
    },
  },
]

/** Détermine le thème depuis le brief. */
function detectTheme(brief: string): ThemeSpec {
  const t = normalize(brief)
  for (const theme of THEMES) {
    if (theme.keywords.test(t)) return theme
  }
  // Thème générique : prairie agréable
  return {
    id: 'generic',
    keywords: /.*/,
    label: 'scène libre',
    background: '#9ec7e8',
    groundColor: '#4a7c4e',
    lighting: 'day',
    build: (rng) => {
      const out: SceneObject[] = [obj('Terrain', 'cylinder', [0, 0.06, 0], [10, 0.12, 10], '#5a9e5a', { roughness: 0.95 })]
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2
        const radius = between(rng, 3.5, 7.5)
        out.push(...arbre(rng, Math.cos(angle) * radius, Math.sin(angle) * radius, between(rng, 0.8, 1.4)))
      }
      out.push(obj('Monument', 'dodecahedron', [0, 1.4, 0], [1.4, 1.6, 1.4], '#8b7d9b', { metalness: 0.4, emissive: '#a78bfa', emissiveIntensity: 0.2 }))
      for (let i = 0; i < 3; i++) out.push(rocher(rng, between(rng, -8, 8), between(rng, -8, 8), between(rng, 0.4, 0.8)))
      out.push(nuage(rng, 7))
      return out
    },
  }
}

/** Génère une scène 3D complète depuis un brief en français. */
export function generateSceneLocal(brief: string): SceneSpec {
  const seed = hashString(brief.toLowerCase().trim())
  const rng = mulberry32(seed)
  const theme = detectTheme(brief)
  idCounter = 0

  // Templates officiels pour les demandes canoniques
  const t = normalize(brief)
  const templateMatch: [RegExp, string][] = [
    [/baseplate|roblox/, 'roblox-baseplate'],
    [/ville neon|ville néon|neon city|cyberpunk/, 'neon-city'],
    [/ile flottante|île flottante|floating/, 'floating-island'],
    [/foret mystique|forêt mystique|mystique/, 'mystic-forest'],
    [/film|cinema|cinéma|movie/, 'movie-set'],
  ]
  for (const [re, id] of templateMatch) {
    if (re.test(t)) {
      const tpl = SCENE_TEMPLATES.find((s) => s.id === id)
      if (tpl) {
        const spec = tpl.build()
        // Animations automatiques sur les objets connus des templates officiels
        const objects = spec.objects.map((o) => {
          if (o.name === 'Anneau holo') return withKeys(o, spinKeys(o, 2, 1, 10))
          if (o.name === 'Sphère holo') return withKeys(o, bobKeys(o, 0.4, 3))
          if (o.name === 'Vehicle volant' || o.name === 'Véhicule volant') return withKeys(o, bobKeys(o, 0.5, 3))
          if (o.name.startsWith('Roche flottante')) return withKeys(o, bobKeys(o, 0.4, 2))
          return o
        })
        return { ...spec, objects, name: spec.name }
      }
    }
  }

  const objects = theme.build(rng)
  return {
    name: `${theme.label.charAt(0).toUpperCase() + theme.label.slice(1)} · NEXUS`,
    background: theme.background,
    ground: true,
    groundColor: theme.groundColor,
    objects,
    lighting: theme.lighting,
    animationDuration: 6,
  }
}
