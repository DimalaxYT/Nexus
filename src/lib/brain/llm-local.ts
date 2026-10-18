// ─── Nexus LLM — pont vers le VRAI modèle de langue local ────────────────────
// `llm/` contient un Transformer GPT écrit de zéro (tokenizer BPE + autograd
// + entraînement, 100 % NumPy) et entraîné dans le dépôt. Ce module est son
// client : il interroge le serveur d'inférence local (`python -m
// nexus_llm.serve`) en HTTP sur la machine — aucun Ollama, aucune API
// externe, aucun tiers. Si le serveur est éteint, tout retombe à `null`
// et le reste de Nexus continue de fonctionner comme avant.

export interface LocalLlmStatus {
  available: boolean
  step?: number
  trainLoss?: number
  valLoss?: number
  params?: number
  vocab?: number
}

export interface LocalLlmOptions {
  maxTokens?: number
  temperature?: number
  topK?: number
  topP?: number
  /** > 1 pénalise les tokens déjà émis (anti-boucles, utile aux petits modèles) */
  repetitionPenalty?: number
  seed?: number
  timeoutMs?: number
}

function baseUrl(): string {
  return (process.env.NEXUS_LLM_URL || 'http://127.0.0.1:8765').replace(/\/$/, '')
}

async function fetchJson(path: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${baseUrl()}${path}`, { ...init, signal: ctrl.signal, cache: 'no-store' })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null // serveur éteint / injoignable : dégradation gracieuse
  } finally {
    clearTimeout(timer)
  }
}

/** Le modèle local répond-il ? (résultat mis en cache 15 s pour ne pas spammer) */
let statusCache: { at: number; value: LocalLlmStatus } | null = null
export async function getLocalLlmStatus(): Promise<LocalLlmStatus> {
  if (statusCache && Date.now() - statusCache.at < 15_000) return statusCache.value
  const data = (await fetchJson('/health', { method: 'GET' }, 2_000)) as Record<string, unknown> | null
  const value: LocalLlmStatus = data?.ok
    ? {
        available: true,
        step: typeof data.step === 'number' ? data.step : undefined,
        trainLoss: typeof data.train_loss === 'number' ? data.train_loss : undefined,
        valLoss: typeof data.val_loss === 'number' ? data.val_loss : undefined,
        params: typeof data.params === 'number' ? data.params : undefined,
        vocab: typeof data.vocab === 'number' ? data.vocab : undefined,
      }
    : { available: false }
  statusCache = { at: Date.now(), value }
  return value
}

/**
 * Génère du texte avec le Nexus LLM local. Renvoie `null` si le modèle
 * n'est pas disponible (l'appelant décide alors du repli).
 */
export async function generateWithLocalLlm(prompt: string, opts: LocalLlmOptions = {}): Promise<string | null> {
  const data = (await fetchJson(
    '/generate',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        max_tokens: Math.min(opts.maxTokens ?? 120, 512),
        temperature: opts.temperature ?? 0.9,
        top_k: opts.topK ?? 40,
        top_p: opts.topP ?? 0.95,
        repetition_penalty: opts.repetitionPenalty ?? 1.1,
        seed: opts.seed,
      }),
    },
    opts.timeoutMs ?? 120_000, // génération CPU token par token : laisser le temps
  )) as Record<string, unknown> | null
  const text = typeof data?.text === 'string' ? data.text.trim() : ''
  return text ? text : null
}
