import type { LightingPreset, PrimitiveType, SceneObject, SceneSpec } from '@/lib/nexus-types'

// ── Presets de matériaux PBR ─────────────────────────────────────────────────

export interface MaterialPreset {
  name: string
  patch: Partial<SceneObject>
}

export const MATERIAL_PRESETS: MaterialPreset[] = [
  { name: 'Métal', patch: { metalness: 0.95, roughness: 0.25, opacity: 1, emissiveIntensity: 0 } },
  { name: 'Or', patch: { metalness: 1, roughness: 0.18, opacity: 1, color: '#d4af37', emissiveIntensity: 0 } },
  { name: 'Plastique', patch: { metalness: 0.05, roughness: 0.55, opacity: 1, emissiveIntensity: 0 } },
  { name: 'Verre', patch: { metalness: 0, roughness: 0.05, opacity: 0.35, emissiveIntensity: 0 } },
  { name: 'Caoutchouc', patch: { metalness: 0, roughness: 0.95, opacity: 1, emissiveIntensity: 0 } },
  { name: 'Néon', patch: { metalness: 0.1, roughness: 0.4, opacity: 1, emissive: '#ffffff', emissiveIntensity: 2 } },
]

// ── Presets d'environnement lumineux ─────────────────────────────────────────

export interface LightConfig {
  label: string
  background: string
  groundColor: string
  ambient: number
  hemi: [string, string, number]
  dir: { position: [number, number, number]; intensity: number; color: string }
  points: { position: [number, number, number]; color: string; intensity: number }[]
}

export const LIGHTING_PRESETS: Record<LightingPreset, LightConfig> = {
  studio: {
    label: 'Studio',
    background: '#09090b',
    groundColor: '#18181b',
    ambient: 0.55,
    hemi: ['#c4b5fd', '#09090b', 0.35],
    dir: { position: [8, 14, 6], intensity: 1.4, color: '#ffffff' },
    points: [{ position: [-6, 4, -6], color: '#a855f7', intensity: 0.4 }],
  },
  day: {
    label: 'Extérieur jour',
    background: '#9ec7e8',
    groundColor: '#4a7c4e',
    ambient: 0.75,
    hemi: ['#eaf6ff', '#4a6741', 0.6],
    dir: { position: [10, 18, 8], intensity: 1.9, color: '#fff7e0' },
    points: [{ position: [-8, 5, -8], color: '#ffe9c4', intensity: 0.3 }],
  },
  neon: {
    label: 'Néon nocturne',
    background: '#0a0414',
    groundColor: '#12101f',
    ambient: 0.3,
    hemi: ['#7c3aed', '#0b0014', 0.5],
    dir: { position: [6, 12, 4], intensity: 0.6, color: '#a78bfa' },
    points: [
      { position: [-6, 3.5, 4], color: '#ec4899', intensity: 1.4 },
      { position: [6, 3.5, -4], color: '#22d3ee', intensity: 1.4 },
    ],
  },
  sunset: {
    label: 'Coucher de soleil',
    background: '#e8956b',
    groundColor: '#4a2f2a',
    ambient: 0.5,
    hemi: ['#ffb37c', '#2a1a2e', 0.5],
    dir: { position: [-10, 5, 6], intensity: 1.7, color: '#ff9d5c' },
    points: [{ position: [8, 3, -6], color: '#ff7a3c', intensity: 0.7 }],
  },
}

// ── Templates de scènes prêts à l'emploi ─────────────────────────────────────

let tplCounter = 0
function obj(
  name: string,
  type: PrimitiveType,
  position: [number, number, number],
  scale: [number, number, number],
  color: string,
  extra: Partial<SceneObject> = {}
): SceneObject {
  tplCounter++
  return {
    id: `tpl-${Date.now().toString(36)}-${tplCounter}`,
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

export interface SceneTemplate {
  id: string
  name: string
  build: () => SceneSpec
}

export const SCENE_TEMPLATES: SceneTemplate[] = [
  {
    id: 'roblox-baseplate',
    name: 'Baseplate Roblox',
    build: () => ({
      name: 'Baseplate Roblox',
      background: '#9ec7e8',
      ground: true,
      groundColor: '#4a7c4e',
      lighting: 'day',
      animationDuration: 6,
      objects: [
        obj('Base', 'box', [0, 0.25, 0], [24, 0.5, 24], '#6b8f5e', { roughness: 0.9, locked: true }),
        obj('Spawn', 'cylinder', [0, 0.55, 0], [2.4, 0.12, 2.4], '#d4af37', { emissive: '#ffd700', emissiveIntensity: 0.35 }),
        obj('Bloc saut 1', 'box', [4, 0.75, -3], [1.5, 1.5, 1.5], '#7c3aed'),
        obj('Bloc saut 2', 'box', [6.2, 1.5, -4.8], [1.5, 1.5, 1.5], '#a855f7'),
        obj('Bloc saut 3', 'box', [8.4, 2.25, -6.6], [1.5, 1.5, 1.5], '#ec4899'),
        obj('Arbre', 'cylinder', [-5, 1.4, -4], [0.5, 2.8, 0.5], '#8a5a2b'),
        obj('Feuillage', 'sphere', [-5, 3.6, -4], [2.4, 2.2, 2.4], '#2f9e44'),
        obj('Arbre 2', 'cylinder', [-7.5, 1.2, -1.5], [0.4, 2.4, 0.4], '#8a5a2b'),
        obj('Feuillage 2', 'sphere', [-7.5, 3.1, -1.5], [2, 1.8, 2], '#37b24d'),
        obj('Muret', 'box', [0, 0.9, 6], [8, 1.8, 0.6], '#9ca3af', { roughness: 0.85 }),
      ],
    }),
  },
  {
    id: 'neon-city',
    name: 'Ville néon',
    build: () => ({
      name: 'Ville néon',
      background: '#0a0414',
      ground: true,
      groundColor: '#12101f',
      lighting: 'neon',
      animationDuration: 6,
      objects: [
        obj('Tour centrale', 'box', [0, 4, 0], [2.4, 8, 2.4], '#1e1b4b', { emissive: '#7c3aed', emissiveIntensity: 0.5, metalness: 0.6, roughness: 0.3 }),
        obj('Tour gauche', 'box', [-4.5, 2.75, -1.5], [1.8, 5.5, 1.8], '#18181b', { emissive: '#ec4899', emissiveIntensity: 0.4 }),
        obj('Tour droite', 'box', [4.5, 3.5, 1.5], [1.8, 7, 1.8], '#18181b', { emissive: '#22d3ee', emissiveIntensity: 0.4 }),
        obj('Immeuble 1', 'box', [-2.5, 1.5, 3.5], [1.4, 3, 1.4], '#27272a', { emissive: '#a855f7', emissiveIntensity: 0.3 }),
        obj('Immeuble 2', 'box', [2.5, 2, -3.5], [1.4, 4, 1.4], '#27272a', { emissive: '#f59e0b', emissiveIntensity: 0.3 }),
        obj('Antenne', 'cylinder', [0, 8.6, 0], [0.08, 1.4, 0.08], '#ec4899', { emissive: '#ec4899', emissiveIntensity: 2 }),
        obj('Anneau holo', 'torus', [0, 5.5, 0], [3, 3, 3], '#22d3ee', { rotation: [1.5708, 0, 0], emissive: '#22d3ee', emissiveIntensity: 1.2, opacity: 0.7 }),
        obj('Sphère holo', 'icosahedron', [0, 9.6, 0], [0.7, 0.7, 0.7], '#ec4899', { emissive: '#ec4899', emissiveIntensity: 1.6 }),
        obj('Vehicle volant', 'capsule', [3.5, 2.2, 5], [0.5, 0.9, 0.5], '#f43f5e', { rotation: [0, 0.6, 0], emissive: '#f43f5e', emissiveIntensity: 0.8 }),
      ],
    }),
  },
  {
    id: 'floating-island',
    name: 'Île flottante',
    build: () => ({
      name: 'Île flottante',
      background: '#1a1033',
      ground: false,
      groundColor: '#18181b',
      lighting: 'sunset',
      animationDuration: 8,
      objects: [
        obj('Socle roche', 'dodecahedron', [0, -1.2, 0], [4, 2.2, 4], '#6b5b73'),
        obj('Terre', 'cylinder', [0, 0.35, 0], [4.4, 0.7, 4.4], '#4a7c4e'),
        obj('Maison corps', 'box', [0, 1.3, 0], [1.8, 1.6, 1.8], '#e8dcc8'),
        obj('Toit', 'cone', [0, 2.65, 0], [1.7, 1.3, 1.7], '#b91c1c'),
        obj('Cheminée', 'box', [0.6, 2.3, 0.6], [0.25, 0.9, 0.25], '#78716c'),
        obj('Arbre', 'cylinder', [-1.5, 1.3, 0.8], [0.22, 1.4, 0.22], '#8a5a2b'),
        obj('Feuillage', 'sphere', [-1.5, 2.4, 0.8], [1.3, 1.2, 1.3], '#37b24d'),
        obj('Petit arbre', 'cylinder', [1.6, 1.15, -0.9], [0.16, 1, 0.16], '#8a5a2b'),
        obj('Feuillage 2', 'icosahedron', [1.6, 2, -0.9], [0.9, 0.9, 0.9], '#2f9e44'),
        obj('Pont', 'box', [2.9, 0.8, 0], [1.6, 0.12, 0.5], '#a16207', { rotation: [0, 0, -0.12] }),
        obj('Roche flottante', 'octahedron', [4.6, 1.4, 0], [0.7, 0.9, 0.7], '#7c6f88'),
        obj('Roche flottante 2', 'tetrahedron', [-4.2, 2.2, -1], [0.6, 0.8, 0.6], '#7c6f88', { rotation: [0.4, 0.8, 0] }),
        obj('Lanterne', 'sphere', [2.9, 1.35, 0], [0.18, 0.18, 0.18], '#ffd700', { emissive: '#ffcc00', emissiveIntensity: 1.8 }),
      ],
    }),
  },
  {
    id: 'mystic-forest',
    name: 'Forêt mystique',
    build: () => ({
      name: 'Forêt mystique',
      background: '#0c1a12',
      ground: true,
      groundColor: '#123324',
      lighting: 'neon',
      animationDuration: 6,
      objects: [
        obj('Grand arbre', 'cylinder', [0, 2.4, 0], [0.7, 4.8, 0.7], '#4a3728'),
        obj('Canopée', 'sphere', [0, 5.4, 0], [3.4, 2.4, 3.4], '#14532d'),
        obj('Arbre fée 1', 'cylinder', [-3, 1.6, -2], [0.4, 3.2, 0.4], '#4a3728'),
        obj('Lueur fée 1', 'sphere', [-3, 3.6, -2], [0.55, 0.55, 0.55], '#4ade80', { emissive: '#4ade80', emissiveIntensity: 2 }),
        obj('Arbre fée 2', 'cylinder', [3.2, 1.3, -1], [0.35, 2.6, 0.35], '#4a3728'),
        obj('Lueur fée 2', 'sphere', [3.2, 2.9, -1], [0.45, 0.45, 0.45], '#22d3ee', { emissive: '#22d3ee', emissiveIntensity: 2 }),
        obj('Champignon 1', 'capsule', [1.4, 0.35, 1.8], [0.3, 0.5, 0.3], '#ec4899', { emissive: '#ec4899', emissiveIntensity: 0.9 }),
        obj('Champignon 2', 'capsule', [1.9, 0.28, 1.4], [0.22, 0.4, 0.22], '#f472b6', { emissive: '#f472b6', emissiveIntensity: 0.9 }),
        obj('Étang', 'cylinder', [-2.2, 0.06, 2.4], [1.8, 0.12, 1.8], '#0e7490', { metalness: 0.7, roughness: 0.12, opacity: 0.85, emissive: '#155e75', emissiveIntensity: 0.3 }),
        obj('Pierre levante', 'box', [0.5, 1.1, -3.4], [0.8, 2.2, 0.5], '#57534e', { rotation: [0.1, 0.5, -0.08], emissive: '#a78bfa', emissiveIntensity: 0.25 }),
        obj('Lucioles', 'icosahedron', [0, 2.2, 2.2], [0.12, 0.12, 0.12], '#fde047', { emissive: '#fde047', emissiveIntensity: 2.4 }),
        obj('Lucioles 2', 'icosahedron', [-1.4, 1.7, 1.2], [0.1, 0.1, 0.1], '#fde047', { emissive: '#fde047', emissiveIntensity: 2.4 }),
      ],
    }),
  },
  {
    id: 'movie-set',
    name: 'Scène de film',
    build: () => ({
      name: 'Scène de film',
      background: '#09090b',
      ground: true,
      groundColor: '#1c1917',
      lighting: 'studio',
      animationDuration: 6,
      objects: [
        obj('Caméra corps', 'box', [-4.5, 1.6, 4], [0.9, 0.6, 1.4], '#27272a', { metalness: 0.7, roughness: 0.35 }),
        obj('Caméra objectif', 'cylinder', [-4.5, 1.6, 2.9], [0.22, 0.5, 0.22], '#18181b', { rotation: [1.5708, 0, 0], metalness: 0.8, roughness: 0.2 }),
        obj('Trépied pied 1', 'cylinder', [-4.8, 0.7, 4.4], [0.05, 1.4, 0.05], '#3f3f46', { rotation: [0.35, 0, 0.2] }),
        obj('Trépied pied 2', 'cylinder', [-4.2, 0.7, 4.4], [0.05, 1.4, 0.05], '#3f3f46', { rotation: [-0.35, 0, -0.2] }),
        obj('Projecteur', 'cone', [4.5, 3, 3], [0.7, 1.2, 0.7], '#facc15', { rotation: [-2.6, 0, 0], emissive: '#fde047', emissiveIntensity: 1.4 }),
        obj('Feu de scène', 'sphere', [2.5, 0.4, -2], [0.5, 0.5, 0.5], '#f97316', { emissive: '#f97316', emissiveIntensity: 1.8 }),
        obj('Personnage', 'capsule', [0, 1, 0], [0.6, 1.2, 0.6], '#e2e8f0'),
        obj('Tête', 'sphere', [0, 2, 0], [0.42, 0.42, 0.42], '#f1c9a5'),
        obj('Chaise', 'box', [1.8, 0.55, 1], [0.6, 1.1, 0.6], '#7c2d12'),
        obj('Ciné claqueta', 'box', [1, 0.05, 3.2], [0.9, 0.1, 0.6], '#0f0f0f', { rotation: [0, 0.5, 0] }),
        obj('Marqueur action', 'torus', [-1.5, 0.1, 2.2], [0.5, 0.5, 0.5], '#dc2626', { rotation: [1.5708, 0, 0], emissive: '#dc2626', emissiveIntensity: 0.6 }),
      ],
    }),
  },
]
