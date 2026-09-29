// ─── NEXUS Brain — Moteur mathématique (parseur à descente récursive) ─────────
// + - * / ^ %, parenthèses, fonctions (sqrt, sin, cos, tan, log, ln, abs,
// round, floor, ceil), constantes (pi, e), pourcentages, moyennes, pgcd/ppcm.
// Codé intégralement from scratch — aucune lib.


type Token = { type: 'num' | 'op' | 'lparen' | 'rparen' | 'func' | 'const'; value: string }

const FUNCTIONS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  racine: Math.sqrt,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  log: Math.log10,
  ln: Math.log,
  abs: Math.abs,
  round: Math.round,
  arrondi: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  exp: Math.exp,
}

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
}

function tokenize(src: string): Token[] | null {
  const tokens: Token[] = []
  let i = 0

  // Normalisation spécifique maths : garde les symboles d'opérateur et parenthèses
  let expr = src
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  // Mots français → opérateurs (avant compactage, avec frontières de mots)
  const words: [RegExp, string][] = [
    [/\bracine\s*(?:carree?\b)?\s*(?:de|du|d')?\s*/g, ' sqrt '],
    [/\bcarree?\s*de\b/g, ' ^2 '],
    [/\bau\s*carre\b/g, ' ^2 '],
    [/\bpuissance\b/g, ' ^ '],
    [/\bplus\b/g, ' + '],
    [/\bmoins\b/g, ' - '],
    [/\bfois\b|\bmultiplie(?:\s+par)?\b/g, ' * '],
    [/\bdivise(?:\s+par)?\b|\bsur\b/g, ' / '],
    [/\blogarithe?\b/g, ' log '],
    [/\b(infini|infinie)\b/g, ' '],
    [/\b(de|du|des|la|le|les|l|d|et|valant|fait|font|combien|calcule|resous|donne|moi|resultat|de|s'il|te|plait)\b/g, ' '],
  ]
  for (const [re, rep] of words) expr = expr.replace(re, ` ${rep} `)
  expr = expr.replace(/\s+/g, '')

  while (i < expr.length) {
    const c = expr[i]
    if (/\d|\./.test(c)) {
      let num = ''
      while (i < expr.length && /[\d.]/.test(expr[i])) num += expr[i++]
      // Notation 1e5
      if (expr[i] === 'e' && /\d/.test(expr[i + 1] ?? '')) {
        num += 'e'
        i++
        while (i < expr.length && /[\d]/.test(expr[i])) num += expr[i++]
      }
      tokens.push({ type: 'num', value: num })
      continue
    }
    if (c === '+' || c === '-' || c === '*' || c === '/' || c === '^' || c === '%') {
      tokens.push({ type: 'op', value: c })
      i++
      continue
    }
    if (c === '(') {
      tokens.push({ type: 'lparen', value: c })
      i++
      continue
    }
    if (c === ')') {
      tokens.push({ type: 'rparen', value: c })
      i++
      continue
    }
    if (/[a-z]/.test(c)) {
      let word = ''
      while (i < expr.length && /[a-z]/.test(expr[i])) word += expr[i++]
      if (word in FUNCTIONS) tokens.push({ type: 'func', value: word })
      else if (word in CONSTANTS) tokens.push({ type: 'const', value: word })
      else return null // mot inconnu → pas une expression pure
      continue
    }
    return null // caractère illégal
  }
  return tokens.length > 0 ? tokens : null
}

/** Parseur récursif : expression → terme → facteur → atome. */
function parse(tokens: Token[]): { value: number } | { error: string } {
  let pos = 0
  const peek = () => tokens[pos]
  const next = () => tokens[pos++]

  const parseExpression = (): number | string => {
    // Gère le unaire -
    let left = parseTerm()
    if (typeof left === 'string') return left
    while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = next().value
      const right = parseTerm()
      if (typeof right === 'string') return right
      left = op === '+' ? left + right : left - right
    }
    return left
  }

  const parseTerm = (): number | string => {
    let left = parseFactor()
    if (typeof left === 'string') return left
    while (peek() && peek().type === 'op' && (peek().value === '*' || peek().value === '/' || peek().value === '%')) {
      const op = next().value
      const right = parseFactor()
      if (typeof right === 'string') return right
      if (op === '*') left = left * right
      else if (op === '/') {
        if (right === 0) return 'division par zéro'
        left = left / right
      } else left = left % right
    }
    return left
  }

  const parseFactor = (): number | string => {
    const base = parseUnary()
    if (typeof base === 'string') return base
    if (peek() && peek().type === 'op' && peek().value === '^') {
      next()
      const exp = parseFactor() // associativité à droite
      if (typeof exp === 'string') return exp
      return Math.pow(base, exp)
    }
    return base
  }

  const parseUnary = (): number | string => {
    if (peek() && peek().type === 'op' && (peek().value === '-' || peek().value === '+')) {
      const op = next().value
      const val = parseUnary()
      if (typeof val === 'string') return val
      return op === '-' ? -val : val
    }
    return parseAtom()
  }

  const parseAtom = (): number | string => {
    const tok = next()
    if (!tok) return 'expression incomplète'
    if (tok.type === 'num') return parseFloat(tok.value)
    if (tok.type === 'const') return CONSTANTS[tok.value] ?? 0
    if (tok.type === 'func') {
      const arg = parseAtom()
      if (typeof arg === 'string') return arg
      return FUNCTIONS[tok.value](arg)
    }
    if (tok.type === 'lparen') {
      const val = parseExpression()
      if (typeof val === 'string') return val
      const closing = next()
      if (!closing || closing.type !== 'rparen') return 'parenthèse fermante manquante'
      return val
    }
    return `élément inattendu : ${tok.value}`
  }

  const result = parseExpression()
  if (typeof result === 'string') return { error: result }
  if (pos !== tokens.length) return { error: 'expression mal formée' }
  if (!Number.isFinite(result)) return { error: 'résultat non fini' }
  return { value: result }
}

// ── Extras : pourcentages, moyennes, pgcd/ppcm (expressions françaises) ───────

function gcd(a: number, b: number): number {
  return b === 0 ? Math.abs(a) : gcd(b, a % b)
}

function formatNum(n: number): string {
  if (Number.isInteger(n)) return String(n)
  const rounded = Math.round(n * 1e6) / 1e6
  return String(rounded)
}

export interface MathResult {
  expression: string
  result: string
  ok: boolean
  detail?: string
}

/** Tente d'évaluer le message comme calcul. Retourne null si ce n'est pas des maths. */
export function evaluateMath(text: string): MathResult | null {
  const t = text.trim()

  // Moyenne : « moyenne de 12 15 et 9 »
  const moyMatch = t.match(/moyenne\s+(de|des)?\s*(.+)/i)
  if (moyMatch) {
    const nums = (moyMatch[2].match(/-?\d+(?:[.,]\d+)?/g) ?? []).map((n) => parseFloat(n.replace(',', '.')))
    if (nums.length >= 2) {
      const avg = nums.reduce((a, b) => a + b, 0) / nums.length
      return { expression: `moyenne de ${nums.join(', ')}`, result: formatNum(avg), ok: true, detail: `somme ${formatNum(nums.reduce((a, b) => a + b, 0))} ÷ ${nums.length} valeurs` }
    }
  }

  // PGCD / PPCM
  const pgcdMatch = t.match(/(pgcd|ppcm)\s+(de|des)?\s*(\d+)\s*(?:et|,|\+)\s*(\d+)/i)
  if (pgcdMatch) {
    const a = parseInt(pgcdMatch[3], 10)
    const b = parseInt(pgcdMatch[4], 10)
    if (pgcdMatch[1].toLowerCase() === 'pgcd') {
      return { expression: `PGCD(${a}, ${b})`, result: String(gcd(a, b)), ok: true, detail: 'algorithme d’Euclide' }
    }
    return { expression: `PPCM(${a}, ${b})`, result: String((a * b) / gcd(a, b)), ok: true, detail: `PGCD(${a}, ${b}) × PPCM(${a}, ${b}) = a × b` }
  }

  // Pourcentage : « 15% de 240 » / « 15 pourcent de 240 »
  const pctMatch = t.match(/(-?\d+(?:[.,]\d+)?)\s*(?:%|pourcent(?:age)?s?)\s*(?:de|du|des|sur)\s*(-?\d+(?:[.,]\d+)?)/i)
  if (pctMatch) {
    const pct = parseFloat(pctMatch[1].replace(',', '.'))
    const total = parseFloat(pctMatch[2].replace(',', '.'))
    return { expression: `${pct}% de ${total}`, result: formatNum((pct / 100) * total), ok: true, detail: `${pct} ÷ 100 × ${total}` }
  }

  // Réduction : « 20 euros moins 15 pourcent »
  const reducMatch = t.match(/(-?\d+(?:[.,]\d+)?)\s*(?:euros?|€|kg|unités?)?\s*(?:moins|-\s*)\s*(\d+(?:[.,]\d+)?)\s*(?:%|pourcent(?:age)?s?)/i)
  if (reducMatch) {
    const base = parseFloat(reducMatch[1].replace(',', '.'))
    const pct = parseFloat(reducMatch[2].replace(',', '.'))
    return { expression: `${base} − ${pct}%`, result: formatNum(base * (1 - pct / 100)), ok: true, detail: `−${formatNum((pct / 100) * base)}` }
  }

  // Expression arithmétique pure (garde-fou : un chiffre ET un opérateur/fonction/mot-math)
  const looksMath =
    /\d/.test(t) &&
    /[+\-*/^x%×÷()]|racine|sqrt|sin|cos|tan|log|ln|puissance|carre|pi\b|abs|arrondi|round|exp|\bplus\b|\bmoins\b|\bfois\b|divis|multipli|moyenne|pourcent|pgcd|ppcm/i.test(
      t
    )
  if (!looksMath) return null
  const tokens = tokenize(t)
  if (!tokens) return null
  const parsed = parse(tokens)
  if ('error' in parsed) return { expression: t.slice(0, 60), result: parsed.error, ok: false }
  return { expression: t.slice(0, 60), result: formatNum(parsed.value), ok: true }
}
