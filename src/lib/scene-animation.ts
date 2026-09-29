import type { SceneObject, SceneKeyframe } from '@/lib/nexus-types'

type Vec3 = [number, number, number]

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
}

/**
 * Échantillonne la transformation interpolée d'un objet à l'instant t (0 → 1).
 * Interpolation linéaire entre les deux clés encadrantes (position, rotation, échelle).
 * Retourne null si l'objet n'a pas de clé.
 */
export function sampleKeyframes(
  keyframes: SceneKeyframe[],
  t: number
): { position: Vec3; rotation: Vec3; scale: Vec3 } | null {
  if (keyframes.length === 0) return null
  const sorted = [...keyframes].sort((a, b) => a.t - b.t)

  if (t <= sorted[0].t) {
    const k = sorted[0]
    return { position: k.position, rotation: k.rotation, scale: k.scale }
  }
  const last = sorted[sorted.length - 1]
  if (t >= last.t) {
    return { position: last.position, rotation: last.rotation, scale: last.scale }
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t
      const local = span <= 0 ? 0 : (t - a.t) / span
      // Ease in-out léger pour un mouvement plus naturel
      const e = local < 0.5 ? 2 * local * local : 1 - Math.pow(-2 * local + 2, 2) / 2
      return {
        position: lerpVec(a.position, b.position, e),
        rotation: lerpVec(a.rotation, b.rotation, e),
        scale: lerpVec(a.scale, b.scale, e),
      }
    }
  }
  return null
}

/** Applique la pose animée à tous les meshes fournis (références three live). */
export function applyAnimation(
  objects: SceneObject[],
  meshes: Map<string, import('three').Mesh>,
  t: number
): void {
  for (const obj of objects) {
    if (!obj.keyframes || obj.keyframes.length === 0) continue
    const mesh = meshes.get(obj.id)
    if (!mesh) continue
    const pose = sampleKeyframes(obj.keyframes, t)
    if (!pose) continue
    mesh.position.set(...pose.position)
    mesh.rotation.set(...pose.rotation)
    mesh.scale.set(...pose.scale)
  }
}
