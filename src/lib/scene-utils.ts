import {
  PRIMITIVE_TYPES,
  type LightingPreset,
  type PrimitiveType,
  type SceneObject,
  type SceneSpec,
} from '@/lib/nexus-types'

export function extractJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json/gi, '```').replace(/```/g, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/
const safeColor = (v: unknown, fallback: string) =>
  typeof v === 'string' && HEX_RE.test(v.trim()) ? v.trim().toLowerCase() : fallback

const num = (v: unknown, fallback: number, min = -100, max = 100) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback

function vec3(
  v: unknown,
  fallback: [number, number, number],
  min = -100,
  max = 100
): [number, number, number] {
  if (typeof v === 'number' && Number.isFinite(v)) return [v, v, v]
  if (Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return [
      num(v[0], fallback[0], min, max),
      num(v[1], fallback[1], min, max),
      num(v[2], fallback[2], min, max),
    ]
  }
  return fallback
}

const LIGHTINGS: LightingPreset[] = ['studio', 'day', 'neon', 'sunset']

export function sanitizeScene(raw: unknown, fallbackName = 'Scène IA'): SceneSpec | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.objects) || r.objects.length === 0) return null

  const palette = ['#a855f7', '#ec4899', '#10b981', '#f59e0b', '#f43f5e', '#14b8a6', '#e2e8f0']
  const objects: SceneObject[] = (r.objects as Record<string, unknown>[])
    .slice(0, 40)
    .map((o, i) => {
      const type = (PRIMITIVE_TYPES as string[]).includes(String(o.type))
        ? (o.type as PrimitiveType)
        : 'box'
      return {
        id: `obj-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 6)}`,
        name: typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 40) : `${type} ${i + 1}`,
        type,
        position: vec3(o.position, [0, 0.5, 0], -50, 50),
        rotation: vec3(o.rotation, [0, 0, 0], -6.3, 6.3),
        scale: vec3(o.scale, [1, 1, 1], 0.05, 20),
        color: safeColor(o.color, palette[i % palette.length]),
        metalness: num(o.metalness, 0.2, 0, 1),
        roughness: num(o.roughness, 0.5, 0, 1),
        opacity: num(o.opacity, 1, 0.1, 1),
        emissive: safeColor(o.emissive, '#000000'),
        emissiveIntensity: num(o.emissiveIntensity, 0, 0, 3),
        visible: o.visible === false ? false : true,
        locked: o.locked === true,
        segments: num(o.segments, 32, 6, 64),
      }
    })

  const lighting = LIGHTINGS.includes(String(r.lighting) as LightingPreset)
    ? (String(r.lighting) as LightingPreset)
    : 'studio'

  return {
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 60) : fallbackName,
    background: safeColor(r.background, '#09090b'),
    ground: r.ground !== false,
    groundColor: safeColor(r.groundColor, '#18181b'),
    objects,
    lighting,
    animationDuration: num(r.animationDuration, 6, 1, 60),
  }
}

export { safeColor }
