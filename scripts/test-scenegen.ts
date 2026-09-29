// Test des 4 nouveaux thèmes 3D : comptage d'objets + clés d'animation
import { generateSceneLocal } from '../src/lib/brain/scenegen'

const BRIEFS = [
  'un récif de corail sous-marin avec des poissons',
  'un désert avec des pyramides et un oasis',
  'un volcan en éruption avec de la lave',
  'des montagnes avec un lac de montagne et un refuge',
  'une ville cyberpunk', // non-régression
]

for (const brief of BRIEFS) {
  const scene = generateSceneLocal(brief)
  const animated = scene.objects.filter((o) => (o.keyframes?.length ?? 0) > 1).length
  console.log(`${scene.name}: ${scene.objects.length} objets, ${animated} animés`)
}
