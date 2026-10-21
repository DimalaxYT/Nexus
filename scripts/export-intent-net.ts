// Régénère les poids livrés du classifieur d'intentions :
//   public/models/nexus-intent-v1.json (empreinte, intentions, précision)
//   public/models/nexus-intent-v1.bin  (poids Float32 little-endian)
// À lancer après toute modification de src/lib/brain/dataset.ts, du vectoriseur
// (src/lib/brain/neural.ts, src/lib/brain/text.ts) ou des hyperparamètres :
//   npx tsx scripts/export-intent-net.ts
// Sans régénération, le serveur s'en aperçoit (empreinte différente) et
// réentraîne le réseau lui-même au démarrage, en arrière-plan.

import { exportIntentNet } from '../src/lib/brain/classifier'

const meta = exportIntentNet()
console.log(
  `[intent-net] ${meta.samples} exemples, ${meta.labels.length} intentions, précision ${(meta.accuracy * 100).toFixed(2)} % — ` +
    `entraîné et écrit en ${meta.ms} ms\n  empreinte ${meta.fingerprint.slice(0, 16)}…  sha256 ${meta.sha256.slice(0, 16)}…`
)
