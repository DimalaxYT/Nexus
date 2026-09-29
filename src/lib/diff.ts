// ─── Diff ligne-à-ligne (LCS) pour les propositions de code ──────────────────
// Sert au panneau « Propositions » du Studio Code : l'agent propose une
// version, l'utilisateur voit EXACTEMENT ce qui change (ajouts / suppressions)
// et valide — jamais de modification sans relecture.

export type DiffLineType = 'ctx' | 'add' | 'del'

export interface DiffLine {
  type: DiffLineType
  text: string
  oldNo?: number // numéro de ligne dans l'ancienne version (del/ctx)
  newNo?: number // numéro de ligne dans la nouvelle version (add/ctx)
}

interface DiffStats {
  added: number
  removed: number
}

/** Diff LCS classique sur les lignes (fichiers de quelques centaines de lignes max). */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = (oldText || '').split('\n')
  const b = (newText || '').split('\n')
  const n = a.length
  const m = b.length

  // Identiques → pas de diff
  if (oldText === newText) return a.map((text, i) => ({ type: 'ctx' as const, text, oldNo: i + 1, newNo: i + 1 }))

  // Table LCS (limite de sécurité : fichiers très longs → diff naïf par ligne entière)
  if (n * m > 4_000_000) {
    return [
      ...a.map((text, i) => ({ type: 'del' as const, text, oldNo: i + 1 })),
      ...b.map((text, i) => ({ type: 'add' as const, text, newNo: i + 1 })),
    ]
  }

  // dp[i][j] = longueur LCS de a[i..] et b[j..]
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'ctx', text: a[i], oldNo: i + 1, newNo: j + 1 })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', text: a[i], oldNo: i + 1 })
      i++
    } else {
      out.push({ type: 'add', text: b[j], newNo: j + 1 })
      j++
    }
  }
  while (i < n) {
    out.push({ type: 'del', text: a[i], oldNo: i + 1 })
    i++
  }
  while (j < m) {
    out.push({ type: 'add', text: b[j], newNo: j + 1 })
    j++
  }
  return out
}

/** Statistiques rapides d'un diff (+N / −N). */
export function diffStats(lines: DiffLine[]): DiffStats {
  let added = 0
  let removed = 0
  for (const l of lines) {
    if (l.type === 'add') added++
    else if (l.type === 'del') removed++
  }
  return { added, removed }
}

/**
 * Réduit les longues plages de lignes inchangées : au-delà de `keep` lignes de
 * contexte autour des changements, on insère une ligne « … N lignes … ».
 */
export function collapseDiff(lines: DiffLine[], keep = 3): (DiffLine | { type: 'gap'; count: number })[] {
  // Indices des lignes modifiées
  const changed = new Set<number>()
  lines.forEach((l, idx) => {
    if (l.type !== 'ctx') {
      for (let k = Math.max(0, idx - keep); k <= Math.min(lines.length - 1, idx + keep); k++) changed.add(k)
    }
  })
  if (changed.size === 0) {
    // Aucun changement : montrer le début du fichier tronqué
    const head = lines.slice(0, keep * 2)
    const out: (DiffLine | { type: 'gap'; count: number })[] = [...head]
    if (lines.length > head.length) out.push({ type: 'gap', count: lines.length - head.length })
    return out
  }

  const out: (DiffLine | { type: 'gap'; count: number })[] = []
  let gapStart = -1
  let gapLen = 0
  for (let idx = 0; idx < lines.length; idx++) {
    if (changed.has(idx)) {
      if (gapLen > 0) {
        out.push({ type: 'gap', count: gapLen })
        gapStart = -1
        gapLen = 0
      }
      out.push(lines[idx])
    } else {
      if (gapStart === -1) gapStart = idx
      gapLen++
    }
  }
  if (gapLen > 0) out.push({ type: 'gap', count: gapLen })
  return out
}

/** Champs CodeFiles réellement comparables (nom → contenu). */
export function codeFileEntries(files: { html: string; css: string; js: string }): { key: string; label: string; content: string }[] {
  return [
    { key: 'html', label: 'HTML', content: files.html ?? '' },
    { key: 'css', label: 'CSS', content: files.css ?? '' },
    { key: 'js', label: 'JS / Script', content: files.js ?? '' },
  ]
}
