// ─── NEXUS — Point de contrôle embarqué (poids entraînés hors ligne) ──────────
// Un déploiement neuf (Render, machine d'un utilisateur) doit pouvoir discuter
// tout de suite, sans attendre un entraînement. Comme pour le modèle de code
// (`public/models/nexus-code-v1.*`), le modèle de conversation est entraîné hors
// ligne puis livré dans le dépôt :
//   · `nexus-chat-v1.json` — configuration, lexique du garde-fou, métadonnées,
//   · `nexus-chat-v1.bin`  — poids Float32 little-endian, ordre `paramList()`.
// Ce module les lit depuis le disque et les transforme en `LoadedModel`.
//
// Priorité : un modèle entraîné en base (dashboard Dev) l'emporte toujours sur
// le point de contrôle embarqué — l'utilisateur garde la main sur son cerveau.

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BPE } from './bpe'
import { deserializeWeights, type LmConfig, type LmParams, type Vocab } from './model'
import { CHAT_FORMAT } from './model'

export const SEED_DIR = join(process.cwd(), 'public', 'models')
export const CHAT_SEED = 'nexus-chat-v1'

export interface SeedMeta {
  name: string
  format: string
  config: LmConfig
  /** Table de caractères (tokenizer `char`) ; vide en BPE. */
  vocab?: string[]
  steps: number
  loss: number
  params: number
  corpusChars?: number
  exportedAt: string
}

export interface SeedModel {
  id: string
  cfg: LmConfig
  vocab: Vocab
  params: LmParams
  steps: number
  loss: number
  corpusChars: number
  corpusInfo: Record<string, number>
  createdAt: number
  updatedAt: number
  lexicon: Set<string>
  /** Vrai : poids livrés dans le dépôt (pas entraînés sur cette instance). */
  seeded: boolean
}

let cache: { key: string; model: SeedModel } | null = null

function modelsDir(): string {
  // En production le dossier peut être à côté du build ; on teste les deux.
  const candidates = [SEED_DIR, join(process.cwd(), '.next', 'standalone', 'public', 'models')]
  for (const dir of candidates) if (existsSync(join(dir, `${CHAT_SEED}.json`))) return dir
  return SEED_DIR
}

/** Lit le point de contrôle embarqué (mis en cache selon la date du fichier). */
export function loadSeedModel(name = CHAT_SEED): SeedModel | null {
  const dir = modelsDir()
  const jsonPath = join(dir, `${name}.json`)
  const binPath = join(dir, `${name}.bin`)
  if (!existsSync(jsonPath) || !existsSync(binPath)) return null

  let mtime = 0
  try {
    mtime = statSync(binPath).mtimeMs
  } catch {
    mtime = 0
  }
  const key = `${name}:${mtime}`
  if (cache && cache.key === key) return cache.model

  let meta: SeedMeta
  try {
    meta = JSON.parse(readFileSync(jsonPath, 'utf8')) as SeedMeta
  } catch {
    return null
  }
  const cfg = meta.config
  if (!cfg || typeof cfg.dim !== 'number') return null
  if (cfg.tokenizer === 'bpe' && cfg.vocab !== BPE.modelVocabSize) return null
  if (cfg.tokenizer !== 'bpe' && cfg.vocab !== (meta.vocab ?? []).length) return null

  let params: LmParams
  try {
    const weights = readFileSync(binPath).toString('base64')
    params = deserializeWeights(cfg, weights)
  } catch {
    return null
  }

  const model: SeedModel = {
    id: name,
    cfg,
    // BPE : les ids viennent du tokenizer. Caractère : la table est dans le JSON.
    vocab: { itos: cfg.tokenizer === 'bpe' ? [] : (meta.vocab ?? []) },
    params,
    steps: Number(meta.steps ?? 0),
    loss: Number(meta.loss ?? 0),
    corpusChars: Number(meta.corpusChars ?? 0),
    corpusInfo: { seed: 1 },
    createdAt: mtime,
    updatedAt: mtime,
    lexicon: new Set(cfg.lexicon ?? []),
    seeded: true,
  }
  cache = { key, model }
  return model
}

/** Le point de contrôle embarqué est-il un modèle de conversation utilisable ? */
export function seedIsChatModel(model: SeedModel | null): boolean {
  return Boolean(model && model.cfg.format === CHAT_FORMAT && model.cfg.tokenizer === 'bpe')
}

/**
 * Écrit le point de contrôle (utilisé par `scripts/train-chat.ts`).
 * Écriture atomique : l'entraînement exporte toutes les 50 étapes pendant que le
 * serveur peut lire ces mêmes fichiers — un `.bin` à moitié écrit produirait des
 * poids corrompus. On écrit donc dans un fichier temporaire puis on renomme.
 */
export function writeSeedFiles(dir: string, name: string, meta: SeedMeta, weights: Buffer): void {
  mkdirSync(dir, { recursive: true })
  const binPath = join(dir, `${name}.bin`)
  const jsonPath = join(dir, `${name}.json`)
  writeFileSync(`${binPath}.tmp`, weights)
  writeFileSync(`${jsonPath}.tmp`, JSON.stringify(meta, null, 2))
  renameSync(`${binPath}.tmp`, binPath)
  renameSync(`${jsonPath}.tmp`, jsonPath)
}
