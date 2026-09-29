// ─── NEXUS Brain — Générateur d'art procédural (SVG, 100 % local) ────────────
// Remplace la génération d'images par API : composition algorithmique par
// graine déterministe (même prompt = même image). 8 styles + palettes.

import { hashString, mulberry32, normalize } from './text'

export interface GeneratedArt {
  svg: string
  style: string
  seed: number
  width: number
  height: number
  description: string
}

type RNG = () => number

const between = (rng: RNG, min: number, max: number) => min + rng() * (max - min)
const intBetween = (rng: RNG, min: number, max: number) => Math.floor(between(rng, min, max + 1))
const choice = <T,>(rng: RNG, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length) % arr.length]

function hsl(h: number, s: number, l: number, a = 1): string {
  return a >= 1 ? `hsl(${h.toFixed(0)}, ${s}%, ${l}%)` : `hsla(${h.toFixed(0)}, ${s}%, ${l}%, ${a})`
}

// ── Palettes par ambiance ─────────────────────────────────────────────────────

interface Palette {
  name: string
  sky: [string, string]
  accent: number // teinte HSL
  ground: number
  dark: string
}

function palette(rng: RNG, styleHint?: string, prompt?: string): Palette {
  const presets: Palette[] = [
    { name: 'aube dorée', sky: ['#1a1333', '#ff9a5c'], accent: 35, ground: 265, dark: '#0d0a1f' },
    { name: 'crépuscule violet', sky: ['#0f0c29', '#a44cd3'], accent: 280, ground: 230, dark: '#0b0716' },
    { name: 'nuit électrique', sky: ['#050510', '#1f3d7a'], accent: 190, ground: 220, dark: '#030308' },
    { name: 'lagon', sky: ['#06282e', '#3fc1c9'], accent: 172, ground: 200, dark: '#041416' },
    { name: 'forêt émeraude', sky: ['#0c1f16', '#57c785'], accent: 140, ground: 120, dark: '#081209' },
    { name: 'magma', sky: ['#1a0505', '#ff5722'], accent: 15, ground: 0, dark: '#0d0202' },
    { name: 'bonbon', sky: ['#2b0a3d', '#ff7eb3'], accent: 330, ground: 300, dark: '#180522' },
    { name: 'or glacé', sky: ['#0d1b2a', '#e0e1dd'], accent: 45, ground: 210, dark: '#080f18' },
  ]
  let picked = styleHint === 'neige' ? presets.find((p) => p.name === 'or glacé')!
    : styleHint === 'neon' ? presets.find((p) => p.name === 'nuit électrique')!
    : styleHint === 'espace' ? presets.find((p) => p.name === 'crépuscule violet')!
    : styleHint === 'kawaii' ? presets.find((p) => p.name === 'bonbon')!
    : styleHint === 'desert' ? { name: 'dunes ardentes', sky: ['#2b1508', '#ffb347'] as [string, string], accent: 30, ground: 28, dark: '#180a02' }
    : choice(rng, presets)

  // Les mots de couleur du PROMPT pilotent la teinte d'accent (rouge, bleu, or…)
  if (prompt) {
    const t = normalize(prompt)
    const hueRules: [RegExp, number][] = [
      [/rouge|crimson|scarlat/, 355], [/bleu|blue|azur|ocean/, 210], [/vert|emeraude|emerald/, 140],
      [/orange/, 28], [/jaune|or |dore|doré|golden/, 48], [/violet|pourpre|mauve|purple/, 285],
      [/rose|pink|magenta/, 330], [/cyan|turquoise/, 185], [/blanc|neige|snow|lunaire/, 220],
    ]
    for (const [re, hue] of hueRules) {
      if (re.test(t)) {
        picked = { ...picked, accent: hue, name: `${picked.name} · ${hueLabel(hue)}` }
        break
      }
    }
    // Ambiance sombre / claire explicite
    if (/sombre|noir|dark|nuit|nuit noire|obscur/.test(t)) {
      picked = { ...picked, sky: [picked.dark, picked.sky[0]], name: `${picked.name} · sombre` }
    }
  }
  return picked
}

function hueLabel(hue: number): string {
  const labels: [number, string][] = [[20, 'rouge'], [45, 'or'], [70, 'jaune'], [120, 'vert'], [160, 'turquoise'], [200, 'cyan'], [230, 'bleu'], [270, 'violet'], [310, 'mauve'], [340, 'rose'], [360, 'rouge']]
  for (const [max, label] of labels) if (hue <= max) return label
  return 'teinte'
}

// ── Styles de composition ─────────────────────────────────────────────────────

function skyGradient(id: string, p: Palette): string {
  return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="${p.sky[0]}"/><stop offset="100%" stop-color="${p.sky[1]}"/>
</linearGradient></defs><rect width="100%" height="100%" fill="url(#${id})"/>`
}

function stars(rng: RNG, count: number): string {
  let out = ''
  for (let i = 0; i < count; i++) {
    const x = between(rng, 0, 100)
    const y = between(rng, 0, 55)
    const r = between(rng, 0.1, 0.5)
    out += `<circle cx="${x.toFixed(1)}%" cy="${y.toFixed(1)}%" r="${r.toFixed(2)}" fill="white" opacity="${between(rng, 0.3, 0.9).toFixed(2)}"/>`
  }
  return out
}

function mountains(rng: RNG, p: Palette, layerCount = 3): string {
  let out = ''
  for (let layer = 0; layer < layerCount; layer++) {
    const baseY = 62 + layer * 12
    const light = 18 + layer * 9
    const hue = p.ground
    let path = `M0,100 L0,${baseY}`
    let x = 0
    while (x < 100) {
      const step = between(rng, 12, 26)
      const peak = baseY - between(rng, 8, 26 - layer * 6)
      path += ` L${(x + step / 2).toFixed(1)},${peak.toFixed(1)} L${Math.min(100, x + step).toFixed(1)},${(baseY + between(rng, -4, 4)).toFixed(1)}`
      x += step
    }
    path += ' L100,100 Z'
    out += `<path d="${path}" fill="${hsl(hue, 35, light)}"/>`
  }
  return out
}

function celestialBody(rng: RNG, p: Palette): string {
  const x = between(rng, 20, 80)
  const y = between(rng, 12, 30)
  const r = between(rng, 6, 12)
  const isMoon = rng() > 0.5
  const color = isMoon ? '#f5f3ee' : hsl(p.accent, 95, 62)
  const glow = `<circle cx="${x.toFixed(1)}%" cy="${y.toFixed(1)}%" r="${(r * 2.2).toFixed(1)}%" fill="${color}" opacity="0.18"/>`
  const body = `<circle cx="${x.toFixed(1)}%" cy="${y.toFixed(1)}%" r="${r.toFixed(1)}%" fill="${color}"/>`
  return glow + body
}

function clouds(rng: RNG, count: number): string {
  let out = ''
  for (let i = 0; i < count; i++) {
    const x = between(rng, 8, 88)
    const y = between(rng, 10, 38)
    const w = between(rng, 10, 22)
    out += `<ellipse cx="${x.toFixed(1)}%" cy="${y.toFixed(1)}%" rx="${(w / 2).toFixed(1)}%" ry="${between(rng, 1.2, 2.4).toFixed(1)}%" fill="white" opacity="${between(rng, 0.1, 0.25).toFixed(2)}"/>`
  }
  return out
}

/** Style « paysage » : ciel dégradé, astre, montagnes en couches, nuages. */
function drawLandscape(rng: RNG, p: Palette, w: number, h: number): string {
  return (
    skyGradient('sky', p) +
    stars(rng, 40) +
    celestialBody(rng, p) +
    clouds(rng, intBetween(rng, 2, 5)) +
    mountains(rng, p, 3)
  )
}

/** Style « ville néon » : silhouettes de tours + fenêtres allumées. */
function drawCity(rng: RNG, p: Palette, w: number, h: number): string {
  let out = skyGradient('sky', p) + stars(rng, 60)
  // Lune néon
  out += `<circle cx="78%" cy="16%" r="7%" fill="hsl(${p.accent}, 90%, 70%)" opacity="0.9"/>`
  out += `<circle cx="78%" cy="16%" r="11%" fill="hsl(${p.accent}, 90%, 70%)" opacity="0.15"/>`

  // Tours : 3 plans de profondeur
  for (let layer = 0; layer < 3; layer++) {
    const light = 12 + layer * 8
    const opacity = 1
    let x = -2
    while (x < 102) {
      const bw = between(rng, 5, 12 - layer)
      const bh = between(rng, 25 + layer * 10, 55 + layer * 14)
      const y = 100 - bh
      out += `<rect x="${x.toFixed(1)}%" y="${y.toFixed(1)}%" width="${(bw - 0.4).toFixed(1)}%" height="${bh.toFixed(1)}%" fill="${hsl(p.ground, 40, light)}" opacity="${opacity}"/>`
      // Antenne
      if (rng() > 0.7) {
        out += `<rect x="${(x + bw / 2 - 0.15).toFixed(1)}%" y="${(y - 5).toFixed(1)}%" width="0.3%" height="5%" fill="${hsl(p.accent, 90, 60)}"/>`
        out += `<circle cx="${(x + bw / 2).toFixed(1)}%" cy="${(y - 5.3).toFixed(1)}%" r="0.4%" fill="hsl(${p.accent}, 95%, 75%)"/>`
      }
      // Fenêtres
      const cols = Math.max(2, Math.floor(bw / 1.6))
      const rows = Math.floor(bh / 4)
      for (let cx = 0; cx < cols; cx++) {
        for (let cy = 0; cy < rows; cy++) {
          if (rng() > 0.62) {
            out += `<rect x="${(x + 0.6 + cx * 1.4).toFixed(2)}%" y="${(y + 1.4 + cy * 3.4).toFixed(2)}%" width="0.55%" height="1.3%" fill="hsl(${rng() > 0.3 ? p.accent : 45}, 95%, ${between(rng, 55, 75).toFixed(0)}%)" opacity="${between(rng, 0.5, 0.95).toFixed(2)}"/>`
          }
        }
      }
      x += bw
    }
  }
  // Reflets au sol
  out += `<rect x="0" y="96%" width="100%" height="4%" fill="hsl(${p.accent}, 80%, 30%)" opacity="0.25"/>`
  return out
}

/** Style « forêt » : sapins en couches + brume. */
function drawForest(rng: RNG, p: Palette, w: number, h: number): string {
  let out = skyGradient('sky', p) + stars(rng, 20) + celestialBody(rng, p)
  // Brume
  out += `<rect x="0" y="55%" width="100%" height="18%" fill="white" opacity="0.08"/>`
  for (let layer = 0; layer < 3; layer++) {
    const light = 14 + layer * 10
    const scale = 1 - layer * 0.28
    const count = intBetween(rng, 6, 10)
    for (let i = 0; i < count; i++) {
      const x = between(rng, 2, 98)
      const baseY = 88 + layer * 4 + between(rng, -3, 3)
      const th = between(rng, 18, 34) * scale // hauteur sapin
      const tw = th * between(rng, 0.35, 0.5)
      // Tronc
      out += `<rect x="${(x - tw * 0.06).toFixed(1)}%" y="${(baseY - th * 0.2).toFixed(1)}%" width="${(tw * 0.12).toFixed(1)}%" height="${(th * 0.22).toFixed(1)}%" fill="${hsl(28, 40, 12 + layer * 4)}"/>`
      // Trois étages de feuillage
      for (let s = 0; s < 3; s++) {
        const segTop = baseY - th + (s * th) / 3.2
        const segWidth = tw * (0.45 + s * 0.3)
        const segBottom = segTop + th / 2.6
        out += `<path d="M${x.toFixed(1)},${segTop.toFixed(1)} L${(x - segWidth / 2).toFixed(1)},${segBottom.toFixed(1)} L${(x + segWidth / 2).toFixed(1)},${segBottom.toFixed(1)} Z" fill="${hsl(p.accent + between(rng, -20, 20), 45, light + s * 4)}"/>`
      }
    }
  }
  return out
}

/** Style « espace » : planète annelée, nébuleuses, étoiles. */
function drawSpace(rng: RNG, p: Palette, w: number, h: number): string {
  let out = skyGradient('sky', p) + stars(rng, 120)
  // Nébuleuses
  for (let i = 0; i < 4; i++) {
    out += `<ellipse cx="${between(rng, 10, 90).toFixed(1)}%" cy="${between(rng, 10, 70).toFixed(1)}%" rx="${between(rng, 12, 28).toFixed(1)}%" ry="${between(rng, 6, 14).toFixed(1)}%" fill="hsl(${between(rng, 250, 330).toFixed(0)}, 80%, 60%)" opacity="${between(rng, 0.05, 0.14).toFixed(2)}"/>`
  }
  // Planète principale
  const px = between(rng, 30, 70)
  const py = between(rng, 40, 62)
  const pr = between(rng, 14, 22)
  const hue = between(rng, 0, 360)
  out += `<circle cx="${px.toFixed(1)}%" cy="${py.toFixed(1)}%" r="${(pr * 1.6).toFixed(1)}%" fill="hsl(${hue}, 70%, 50%)" opacity="0.12"/>`
  out += `<defs><radialGradient id="planet" cx="35%" cy="30%"><stop offset="0%" stop-color="hsl(${hue}, 65%, 68%)"/><stop offset="100%" stop-color="hsl(${hue}, 75%, 28%)"/></radialGradient></defs>`
  out += `<circle cx="${px.toFixed(1)}%" cy="${py.toFixed(1)}%" r="${pr.toFixed(1)}%" fill="url(#planet)"/>`
  // Anneau
  const tilt = between(rng, -18, 18)
  out += `<g transform="rotate(${tilt.toFixed(1)}, ${px.toFixed(1)}, ${py.toFixed(1)})"><ellipse cx="${px.toFixed(1)}%" cy="${py.toFixed(1)}%" rx="${(pr * 1.55).toFixed(1)}%" ry="${(pr * 0.42).toFixed(1)}%" fill="none" stroke="hsl(${hue}, 40%, 75%)" stroke-width="${(pr * 0.1).toFixed(1)}%" opacity="0.7"/></g>`
  // Lune lointaine
  out += `<circle cx="${between(rng, 5, 95).toFixed(1)}%" cy="${between(rng, 8, 30).toFixed(1)}%" r="${between(rng, 1.5, 3).toFixed(1)}%" fill="hsl(${between(rng, 0, 360).toFixed(0)}, 40%, 70%)"/>`
  return out
}

/** Style « océan » : vagues superposées + soleil. */
function drawOcean(rng: RNG, p: Palette, w: number, h: number): string {
  let out = skyGradient('sky', p) + celestialBody(rng, p) + clouds(rng, 3)
  for (let layer = 0; layer < 5; layer++) {
    const y = 58 + layer * 8
    const amp = between(rng, 1.5, 3.5)
    const hue = p.accent + layer * 6
    const light = 42 - layer * 6
    let path = `M0,100 L0,${y.toFixed(1)}`
    for (let x = 0; x <= 100; x += 4) {
      const waveY = y + Math.sin((x / 100) * Math.PI * between(rng, 2, 4) + layer) * amp
      path += ` L${x},${waveY.toFixed(1)}`
    }
    path += ' L100,100 Z'
    out += `<path d="${path}" fill="${hsl(hue, 55, light)}" opacity="${(0.85 - layer * 0.1).toFixed(2)}"/>`
  }
  return out
}

/** Style « abstrait » : composition géométrique Bauhaus. */
function drawAbstract(rng: RNG, p: Palette, w: number, h: number): string {
  let out = `<rect width="100%" height="100%" fill="${p.dark}"/>`
  const shapes = intBetween(rng, 7, 11)
  for (let i = 0; i < shapes; i++) {
    const hue = (p.accent + between(rng, -60, 60) + 360) % 360
    const sat = between(rng, 60, 90)
    const light = between(rng, 45, 70)
    const color = hsl(hue, sat, light, between(rng, 0.75, 0.95))
    const kind = rng()
    const size = between(rng, 10, 38)
    if (kind < 0.33) {
      out += `<circle cx="${between(rng, 15, 85).toFixed(1)}%" cy="${between(rng, 15, 85).toFixed(1)}%" r="${(size / 2).toFixed(1)}%" fill="${color}"/>`
    } else if (kind < 0.66) {
      out += `<rect x="${between(rng, 5, 70).toFixed(1)}%" y="${between(rng, 5, 70).toFixed(1)}%" width="${size.toFixed(1)}%" height="${(size * between(rng, 0.4, 1.6)).toFixed(1)}%" rx="${(size * 0.1).toFixed(1)}%" fill="${color}" transform="rotate(${between(rng, -30, 30).toFixed(0)}, 50, 50)"/>`
    } else {
      const x = between(rng, 10, 80)
      const y = between(rng, 10, 80)
      const s = size
      out += `<path d="M${x.toFixed(1)},${(y + s).toFixed(1)} L${(x + s / 2).toFixed(1)},${y.toFixed(1)} L${(x + s).toFixed(1)},${(y + s).toFixed(1)} Z" fill="${color}"/>`
    }
  }
  // Ligne de composition
  out += `<line x1="0" y1="${between(rng, 25, 75).toFixed(1)}%" x2="100%" y2="${between(rng, 25, 75).toFixed(1)}%" stroke="${hsl(p.accent, 90, 70, 0.5)}" stroke-width="0.5"/>`
  return out
}

/** Style « kawaii » : personnage mignon simple. */
function drawKawaii(rng: RNG, p: Palette, w: number, h: number): string {
  const hue = between(rng, 320, 360)
  const cx = 50
  const cy = 52
  const r = 26
  let out = skyGradient('sky', p)
  // Étoiles décoratives
  for (let i = 0; i < 12; i++) {
    const sx = between(rng, 5, 95)
    const sy = between(rng, 5, 40)
    out += `<path d="M${sx.toFixed(1)},${sy.toFixed(1)} l0.8,1.8 2,0.2 -1.4,1.3 0.4,2 -1.8,-1 -1.8,1 0.4,-2 -1.4,-1.3 2,-0.2 Z" fill="white" opacity="${between(rng, 0.5, 0.95).toFixed(2)}"/>`
  }
  // Corps
  out += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="hsl(${hue.toFixed(0)}, 85%, 75%)"/>`
  out += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="hsl(${hue.toFixed(0)}, 70%, 60%)" stroke-width="1.2"/>`
  // Joues
  out += `<circle cx="${cx - r * 0.55}" cy="${cy + r * 0.25}" r="${r * 0.16}" fill="hsl(350, 90%, 72%, 0.8)"/>`
  out += `<circle cx="${cx + r * 0.55}" cy="${cy + r * 0.25}" r="${r * 0.16}" fill="hsl(350, 90%, 72%, 0.8)"/>`
  // Yeux
  out += `<circle cx="${cx - r * 0.32}" cy="${cy - r * 0.12}" r="${r * 0.09}" fill="#1b1024"/>`
  out += `<circle cx="${cx + r * 0.32}" cy="${cy - r * 0.12}" r="${r * 0.09}" fill="#1b1024"/>`
  out += `<circle cx="${cx - r * 0.29}" cy="${cy - r * 0.15}" r="${r * 0.03}" fill="white"/>`
  out += `<circle cx="${cx + r * 0.35}" cy="${cy - r * 0.15}" r="${r * 0.03}" fill="white"/>`
  // Bouche
  out += `<path d="M${cx - r * 0.14},${(cy + r * 0.2).toFixed(1)} Q${cx},${(cy + r * 0.38).toFixed(1)} ${cx + r * 0.14},${(cy + r * 0.2).toFixed(1)}" fill="none" stroke="#1b1024" stroke-width="1" stroke-linecap="round"/>`
  return out
}

/** Style « pixel » : mosaïque générée par bruit de graine. */
function drawPixel(rng: RNG, p: Palette, w: number, h: number): string {
  const grid = 16
  const cell = 100 / grid
  let out = `<rect width="100%" height="100%" fill="${p.dark}"/>`
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      if (rng() > 0.55) continue
      const hue = (p.accent + Math.sin((gx + gy) / 3) * 40 + between(rng, -15, 15) + 360) % 360
      const light = 30 + ((gx * gy) % 40)
      out += `<rect x="${(gx * cell).toFixed(2)}%" y="${(gy * cell).toFixed(2)}%" width="${cell.toFixed(2)}%" height="${cell.toFixed(2)}%" fill="${hsl(hue, 65, light)}"/>`
    }
  }
  return out
}

/** Style « logo » : monogramme dans un badge géométrique. */
function drawLogo(rng: RNG, p: Palette, label: string, w: number, h: number): string {
  const initials = label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((wd) => wd[0]?.toUpperCase() ?? 'N')
    .join('') || 'NX'
  const hue = p.accent
  const shape = rng()
  let badge: string
  if (shape < 0.4) {
    badge = `<circle cx="50" cy="47" r="30" fill="url(#lg)"/>`
  } else if (shape < 0.75) {
    badge = `<rect x="22" y="19" width="56" height="56" rx="14" fill="url(#lg)"/>`
  } else {
    badge = `<path d="M50,14 L82,47 L50,80 L18,47 Z" fill="url(#lg)"/>`
  }
  return (
    `<defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
<stop offset="0%" stop-color="${hsl(hue, 85, 62)}"/><stop offset="100%" stop-color="${hsl((hue + 45) % 360, 85, 45)}"/>
</linearGradient></defs>
<rect width="100%" height="100%" fill="${p.dark}"/>
${badge}
<text x="50" y="47" text-anchor="middle" dominant-baseline="central" font-family="Arial, sans-serif" font-weight="bold" font-size="${initials.length > 1 ? 24 : 30}" fill="white" opacity="0.95">${initials}</text>
<text x="50" y="90" text-anchor="middle" font-family="Arial, sans-serif" font-size="6" letter-spacing="2" fill="${hsl(hue, 60, 75, 0.85)}">${label.slice(0, 22).toUpperCase()}</text>`
  )
}

/** Palette dédiée aurore : nuit polaire profonde. */
function auroraPalette(rng: RNG): Palette {
  return { name: 'nuit polaire', sky: ['#020412', '#12305c'], accent: between(rng, 130, 170), ground: 215, dark: '#01020a' }
}

/** Style « aurore » : rideaux lumineux, montagnes enneigées, lac miroir. */
function drawAurora(rng: RNG, p: Palette, w: number, h: number): string {
  const pol = auroraPalette(rng)
  // En paysage, la vue recadrée ne montre que y≈22…78 : on resserre la composition
  const landscape = w > h
  const mountBase = landscape ? [50, 60] : [62, 72]
  const lakeY = landscape ? 68 : 78
  let out = skyGradient('sky', pol) + stars(rng, 130)
  const moonX = between(rng, 62, 84)
  const moonY = between(rng, 10, 20)
  // Lune froide
  out += `<circle cx="${moonX.toFixed(1)}%" cy="${moonY.toFixed(1)}%" r="5%" fill="#eef5fb" opacity="0.92"/>`
  out += `<circle cx="${moonX.toFixed(1)}%" cy="${moonY.toFixed(1)}%" r="9%" fill="#eef5fb" opacity="0.12"/>`
  // Rideaux d'aurore : bandes verticales courbes, dégradé vert → turquoise → violet, bords flous
  const bands = intBetween(rng, 4, 6)
  out += `<defs><filter id="soften" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.3"/></filter></defs>`
  out += '<g filter="url(#soften)">'
  for (let b = 0; b < bands; b++) {
    const bx = between(rng, -5, 85)
    const topY = between(rng, 4, 16)
    const botY = between(rng, 42, 58)
    const width = between(rng, 4, 9)
    const hue1 = between(rng, 120, 165)
    const gradId = `aur${b}`
    out += `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="${hsl(hue1, 95, 65, 0)}"/>
<stop offset="35%" stop-color="${hsl(hue1, 95, 62, 0.5)}"/>
<stop offset="80%" stop-color="${hsl(hue1 + 40, 95, 58, 0.34)}"/>
<stop offset="100%" stop-color="${hsl(285, 90, 62, 0.14)}"/>
</linearGradient></defs>`
    out += `<path d="M${bx.toFixed(1)},${botY.toFixed(1)} C${(bx + width * 0.4).toFixed(1)},${((topY + botY) / 2 - 6).toFixed(1)} ${(bx + width * 0.7).toFixed(1)},${(topY + 8).toFixed(1)} ${(bx + width).toFixed(1)},${topY.toFixed(1)} L${(bx + width * 1.5).toFixed(1)},${topY.toFixed(1)} C${(bx + width * 1.2).toFixed(1)},${((topY + botY) / 2 + 4).toFixed(1)} ${(bx + width * 1.1).toFixed(1)},${(botY + 6).toFixed(1)} ${(bx + width * 0.6).toFixed(1)},${(botY + 8).toFixed(1)} Z" fill="url(#${gradId})"/>`
  }
  out += '</g>'
  // Montagnes enneigées (2 couches froides, sommets lumineux sans contour dur)
  for (let layer = 0; layer < 2; layer++) {
    const baseY = mountBase[layer] ?? 62 + layer * 10
    const light = 30 + layer * 14
    let path = `M0,100 L0,${baseY}`
    let x = 0
    const peaks: [number, number][] = []
    while (x < 100) {
      const step = between(rng, 10, 24)
      const peak = baseY - between(rng, 10, 22 - layer * 7)
      peaks.push([x + step / 2, peak])
      path += ` L${(x + step / 2).toFixed(1)},${peak.toFixed(1)} L${Math.min(100, x + step).toFixed(1)},${(baseY + between(rng, -3, 3)).toFixed(1)}`
      x += step
    }
    path += ' L100,100 Z'
    out += `<path d="${path}" fill="${hsl(215, 32, light)}"/>`
    // Neige posée sur les sommets : petits triangles clairs au sommet
    for (const [pkx, pky] of peaks.slice(0, 6)) {
      const sw = between(rng, 3, 5.5)
      out += `<path d="M${pkx.toFixed(1)},${pky.toFixed(1)} L${(pkx - sw / 2).toFixed(1)},${(pky + sw * 0.45).toFixed(1)} L${(pkx - sw * 0.18).toFixed(1)},${(pky + sw * 0.36).toFixed(1)} L${pkx.toFixed(1)},${(pky + sw * 0.5).toFixed(1)} L${(pkx + sw * 0.2).toFixed(1)},${(pky + sw * 0.38).toFixed(1)} L${(pkx + sw / 2).toFixed(1)},${(pky + sw * 0.45).toFixed(1)} Z" fill="#dceafc" opacity="${(0.75 - layer * 0.25).toFixed(2)}"/>`
    }
  }
  // Lac miroir : reflet des aurores (bandes verticales estompées, flou)
  out += `<rect x="0" y="${lakeY}%" width="100%" height="${100 - lakeY}%" fill="${hsl(220, 45, 10)}"/>`
  out += '<g filter="url(#soften)">'
  for (let b = 0; b < bands; b++) {
    const bx = between(rng, -5, 85)
    const width = between(rng, 4, 9)
    out += `<rect x="${bx.toFixed(1)}%" y="${lakeY}%" width="${width.toFixed(1)}%" height="${100 - lakeY}%" fill="${hsl(between(rng, 130, 165), 85, 40)}" opacity="0.14"/>`
  }
  out += '</g>'
  for (let i = 0; i < 9; i++) {
    out += `<line x1="${between(rng, 0, 100).toFixed(1)}%" y1="${(lakeY + 1 + rng() * (100 - lakeY) * 0.6).toFixed(1)}%" x2="${between(rng, 0, 100).toFixed(1)}%" y2="${(lakeY + 6 + rng() * (100 - lakeY) * 0.8).toFixed(1)}%" stroke="#9fd8ff" stroke-width="0.12" opacity="0.3"/>`
  }
  return out
}

/** Palette dédiée cascade : vallée verdoyante en plein jour. */
function cascadePalette(rng: RNG): Palette {
  return { name: 'valée verdoyante', sky: ['#7ec8e3', '#fff3c4'], accent: between(rng, 155, 175), ground: 130, dark: '#173a2b' }
}

/** Style « cascade » : falaises à plateau, voile d'eau, bassin, brume et arc-en-ciel. */
function drawCascade(rng: RNG, p: Palette, w: number, h: number): string {
  const pal = cascadePalette(rng)
  const landscape = w > h
  // Ancres verticales : en paysage, la vue recadrée ne montre que y≈22…78
  const topY = landscape ? 30 : between(rng, 24, 32)
  const basinY = landscape ? 76 : 97
  const mistY1 = landscape ? 71 : 88
  const mistY2 = landscape ? 74 : 92
  const rbY = landscape ? 69 : 88
  let out = skyGradient('sky', pal) + clouds(rng, intBetween(rng, 2, 4))
  // Soleil discret en haut
  const sunX = between(rng, 78, 90)
  const sunY = landscape ? 28 : between(rng, 8, 16)
  out += `<circle cx="${sunX.toFixed(1)}%" cy="${sunY.toFixed(1)}%" r="4.5%" fill="${hsl(48, 95, 68)}"/>`
  out += `<circle cx="${sunX.toFixed(1)}%" cy="${sunY.toFixed(1)}%" r="8%" fill="${hsl(48, 95, 68)}" opacity="0.18"/>`
  const gapL = between(rng, 36, 44)
  const gapR = gapL + between(rng, 16, 22)
  // Falaises : plateau plat au sommet, paroi intérieure irrégulière en gradins
  const jag = (x: number, y0: number, y1: number, up: boolean): string => {
    let seg = ''
    if (up) {
      let y = y1
      while (y > y0) {
        y = Math.max(y0, y - between(rng, 6, 12))
        seg += ` L${(x + between(rng, -2.5, 2.5)).toFixed(1)},${y.toFixed(1)}`
      }
    } else {
      let y = y0
      while (y < y1) {
        y = Math.min(y1, y + between(rng, 6, 12))
        seg += ` L${(x + between(rng, -2.5, 2.5)).toFixed(1)},${y.toFixed(1)}`
      }
    }
    return seg
  }
  // Falaise gauche : plateau puis paroi jaguée qui descend côté cascade
  out += `<path d="M-2,100 L-2,${topY.toFixed(1)} L${gapL.toFixed(1)},${topY.toFixed(1)}${jag(gapL, topY, 100, false)} L${gapL.toFixed(1)},100 Z" fill="${hsl(pal.ground, 24, 20)}"/>`
  // Falaise droite : paroi jaguée qui monte côté cascade puis plateau
  out += `<path d="M${gapR.toFixed(1)},100${jag(gapR, topY, 100, true)} L102,${topY.toFixed(1)} L102,100 Z" fill="${hsl(pal.ground, 24, 24)}"/>`
  // Strates horizontales + mousses sur les deux parois
  for (const [cx0, cx1] of [[0, gapL], [gapR, 100]] as const) {
    for (let i = 0; i < 4; i++) {
      const sy = between(rng, topY + 6, 92)
      out += `<line x1="${cx0.toFixed(1)}%" y1="${sy.toFixed(1)}" x2="${(cx0 + (cx1 - cx0) * between(rng, 0.4, 0.9)).toFixed(1)}%" y2="${(sy + between(rng, -2, 2)).toFixed(1)}" stroke="${hsl(pal.ground, 25, 12)}" stroke-width="0.35" opacity="0.4"/>`
      if (rng() > 0.5) out += `<ellipse cx="${between(rng, Math.max(2, cx0), Math.min(96, cx1)).toFixed(1)}%" cy="${(sy + 2).toFixed(1)}%" rx="2.4%" ry="0.8%" fill="${hsl(120, 40, 30)}" opacity="0.55"/>`
    }
  }
  // Rivière amont (eau calme entre les plateaux) + berge
  const riverH = landscape ? 7 : 10
  out += `<rect x="${gapL.toFixed(1)}%" y="${topY.toFixed(1)}%" width="${(gapR - gapL).toFixed(1)}%" height="${riverH}%" fill="${hsl(195, 60, 55)}"/>`
  out += `<rect x="${gapL.toFixed(1)}%" y="${topY.toFixed(1)}%" width="${(gapR - gapL).toFixed(1)}%" height="2.4%" fill="${hsl(195, 75, 70)}" opacity="0.8"/>`
  // Voile de la cascade : bandes verticales blanches/bleutées, bords effilochés
  const fallTop = topY + riverH
  const fallH = basinY - fallTop + (landscape ? 3 : 4)
  out += `<rect x="${gapL.toFixed(1)}%" y="${fallTop.toFixed(1)}%" width="${(gapR - gapL).toFixed(1)}%" height="${fallH.toFixed(1)}%" fill="#dff2fd" opacity="0.3"/>`
  for (let i = 0; i < 26; i++) {
    const x = gapL + (i / 26) * (gapR - gapL)
    const wob = between(rng, -0.7, 0.7)
    out += `<line x1="${x.toFixed(1)}%" y1="${fallTop.toFixed(1)}%" x2="${(x + wob).toFixed(1)}%" y2="${(fallTop + fallH).toFixed(1)}" stroke="${rng() > 0.35 ? '#eaf7ff' : '#bfe3f7'}" stroke-width="${between(rng, 0.22, 0.7).toFixed(2)}" opacity="${between(rng, 0.35, 0.9).toFixed(2)}"/>`
  }
  // Bassin : remous + écume
  out += `<ellipse cx="${((gapL + gapR) / 2).toFixed(1)}%" cy="${(basinY + 1).toFixed(1)}%" rx="${((gapR - gapL) * 1.5).toFixed(1)}%" ry="${landscape ? 5 : 8}%" fill="${hsl(200, 65, 45)}"/>`
  for (let i = 0; i < 14; i++) {
    const fx = between(rng, gapL - 6, gapR + 6)
    out += `<circle cx="${fx.toFixed(1)}%" cy="${between(rng, basinY - 4, basinY + 3).toFixed(1)}%" r="${between(rng, 0.5, 1.6).toFixed(1)}%" fill="white" opacity="${between(rng, 0.25, 0.75).toFixed(2)}"/>`
  }
  // Brume à la base
  out += `<ellipse cx="${((gapL + gapR) / 2).toFixed(1)}%" cy="${mistY1}%" rx="${((gapR - gapL) * 1.9).toFixed(1)}%" ry="${landscape ? 4.5 : 6}%" fill="white" opacity="0.22"/>`
  out += `<ellipse cx="${((gapL + gapR) / 2).toFixed(1)}%" cy="${mistY2}%" rx="${((gapR - gapL) * 1.3).toFixed(1)}%" ry="${landscape ? 3 : 4}%" fill="white" opacity="0.3"/>`
  // Arc-en-ciel enjambant la brume, au-dessus du bassin
  const rbX = (gapL + gapR) / 2
  const rbHues = [0, 30, 55, 110, 190, 240, 285]
  rbHues.forEach((hue, i) => {
    const r = (landscape ? 8 : 10) + i * 1.3
    out += `<path d="M${(rbX - r).toFixed(1)},${rbY} A${r} ${(r * 0.85).toFixed(1)} 0 0 1 ${(rbX + r).toFixed(1)},${rbY}" fill="none" stroke="${hsl(hue, 90, 60)}" stroke-width="0.5" opacity="0.42"/>`
  })
  return out
}

// ── Extras pilotés par le prompt (oiseaux, arc-en-ciel, bateau, phare) ─────

function birdsFlock(rng: RNG): string {
  let out = '<g>'
  for (let i = 0; i < 7; i++) {
    const bx = between(rng, 15, 85)
    const by = between(rng, 12, 32)
    const s = between(rng, 0.8, 1.6)
    out += `<path d="M${bx.toFixed(1)},${by.toFixed(1)} q${(1.2 * s).toFixed(1)},${(-0.9 * s).toFixed(1)} ${(2.4 * s).toFixed(1)},0 M${bx.toFixed(1)},${by.toFixed(1)} q${(-1.2 * s).toFixed(1)},${(-0.9 * s).toFixed(1)} ${(-2.4 * s).toFixed(1)},0" stroke="#2a2438" stroke-width="0.25" fill="none" opacity="0.55"/>`
  }
  return out + '</g>'
}

function rainbow(rng: RNG, cx = 50, baseY = 78): string {
  const hues = [0, 30, 55, 110, 190, 240, 285]
  let out = ''
  hues.forEach((hue, i) => {
    const r = 30 + i * 2
    out += `<path d="M${(cx - r).toFixed(1)},${baseY} A${r} ${r} 0 0 1 ${(cx + r).toFixed(1)},${baseY}" fill="none" stroke="${hsl(hue, 92, 62)}" stroke-width="1.1" opacity="0.3"/>`
  })
  return out
}

function sailboat(rng: RNG, p: Palette, waterY = 74): string {
  const bx = between(rng, 22, 74)
  const s = between(rng, 4, 7)
  const dark = p.dark
  return `<g>
<path d="M${(bx - s).toFixed(1)},${waterY} L${(bx + s).toFixed(1)},${waterY} L${(bx + s * 0.62).toFixed(1)},${(waterY + s * 0.34).toFixed(1)} L${(bx - s * 0.62).toFixed(1)},${(waterY + s * 0.34).toFixed(1)} Z" fill="${dark}"/>
<line x1="${bx}" y1="${waterY}" x2="${bx}" y2="${(waterY - s * 1.5).toFixed(1)}" stroke="${dark}" stroke-width="0.35"/>
<path d="M${(bx + 0.3).toFixed(1)},${(waterY - s * 1.45).toFixed(1)} L${(bx + s * 0.85).toFixed(1)},${(waterY - 0.4).toFixed(1)} L${(bx + 0.3).toFixed(1)},${(waterY - 0.4).toFixed(1)} Z" fill="#f6f1e7"/>
<path d="M${(bx - 0.3).toFixed(1)},${(waterY - s * 1.3).toFixed(1)} L${(bx - s * 0.7).toFixed(1)},${(waterY - 0.5).toFixed(1)} L${(bx - 0.3).toFixed(1)},${(waterY - 0.5).toFixed(1)} Z" fill="${hsl(p.accent, 85, 72)}"/>
</g>`
}

function lighthouse(rng: RNG, p: Palette): string {
  const lx = between(rng, 10, 24)
  const baseY = 84
  const lh = between(rng, 20, 30)
  let out = `<g>`
  out += `<path d="M${(lx - 2.6).toFixed(1)},${baseY} L${(lx - 1.6).toFixed(1)},${(baseY - lh).toFixed(1)} L${(lx + 1.6).toFixed(1)},${(baseY - lh).toFixed(1)} L${(lx + 2.6).toFixed(1)},${baseY} Z" fill="#e8e3da"/>`
  // Rayures rouges
  for (let i = 0; i < 3; i++) {
    const y0 = baseY - lh * (0.25 + i * 0.25)
    const y1 = y0 - lh * 0.14
    const wTop = 2.6 - (2.6 - 1.6) * (1 - i * 0.25)
    out += `<path d="M${(lx - wTop).toFixed(1)},${y0.toFixed(1)} L${(lx - (wTop - 0.3)).toFixed(1)},${y1.toFixed(1)} L${(lx + (wTop - 0.3)).toFixed(1)},${y1.toFixed(1)} L${(lx + wTop).toFixed(1)},${y0.toFixed(1)} Z" fill="#c94f4f"/>`
  }
  // Lanterne + faisceaux
  out += `<rect x="${(lx - 1.7).toFixed(1)}" y="${(baseY - lh - 2.6).toFixed(1)}" width="3.4" height="2.8" fill="#2f2a3a"/>`
  out += `<circle cx="${lx.toFixed(1)}" cy="${(baseY - lh - 1.2).toFixed(1)}" r="0.9" fill="#ffe9a3"/>`
  const tilt = between(rng, -18, 18)
  out += `<g transform="rotate(${tilt.toFixed(0)}, ${lx.toFixed(1)}, ${(baseY - lh - 1.2).toFixed(1)})">
<polygon points="${lx},${baseY - lh - 1.2} ${lx + 34},${baseY - lh - 7} ${lx + 34},${baseY - lh + 3}" fill="#ffe9a3" opacity="0.14"/>
</g>`
  return out + '</g>'
}

// ── Sélection du style par mots-clés ─────────────────────────────────────────────

function detectStyle(text: string): string | null {
  const t = normalize(text)
  const rules: [RegExp, string][] = [
    [/logo|monogramme|icone|icon|brand|marque/, 'logo'],
    [/aurore|boreale|bor[ée]al|nordique/, 'aurore'],
    [/cascade|chute.?d.?eau|waterfall/, 'cascade'],
    [/ville|city|urbain|batiment|immeuble|gratte.?ciel|cyberpunk|neon/, 'ville'],
    [/foret|arbre|sapin|jungle|bois/, 'foret'],
    [/espace|planet|galaxie|etoile|cosmos|astronaut|fusee|nebuleuse/, 'espace'],
    [/ocean|mer|vague|plage|maritime|surf|ile|phare|lighthouse|cote|falaise|voilier|bateau/, 'ocean'],
    [/montagne|paysage|vall[ée]e|coucher|lever|soleil|nature|colline/, 'paysage'],
    [/kawaii|mignon|cute|chat|panda|ourson|adjectif.?mignon/, 'kawaii'],
    [/pixel|retro|8.?bit|16.?bit|vintage/, 'pixel'],
    [/desert|dune|sable|sahara|cactus|oasis|pyramide|chameau/, 'desert'],
    [/neige|snow|hiver|winter|polaire|arctique|givre|flocon/, 'neige'],
    [/abstrait|geometri|moderne|bauhaus|art g[ée]n[ée]ratif/, 'abstrait'],
  ]
  for (const [re, style] of rules) {
    if (re.test(t)) return style
  }
  return null
}

const STYLE_LABELS: Record<string, string> = {
  paysage: 'paysage montagneux',
  ville: 'ville néon',
  foret: 'forêt en couches',
  espace: 'scène spatiale',
  ocean: 'océan de vagues',
  abstrait: 'composition abstraite',
  kawaii: 'personnage kawaii',
  pixel: 'mosaïque pixel',
  desert: 'dunes de désert',
  neige: 'paysage enneigé',
  aurore: 'aurore boréale',
  cascade: 'cascade en montagne',
  logo: 'logo monogramme',
}

// ── Nouveaux styles ───────────────────────────────────────────────────────────

/** Style « désert » : dunes de sable en couches, soleil brûlant, cactus. */
function drawDesert(rng: RNG, p: Palette, w: number, h: number): string {
  let out = skyGradient('sky', p) + celestialBody(rng, { ...p, accent: 30 })
  // Oiseaux lointains
  for (let i = 0; i < 5; i++) {
    const bx = between(rng, 15, 85)
    const by = between(rng, 12, 30)
    const s = between(rng, 0.8, 1.6)
    out += `<path d="M${bx.toFixed(1)},${by.toFixed(1)} q${(1.2 * s).toFixed(1)},${(-0.9 * s).toFixed(1)} ${(2.4 * s).toFixed(1)},0 M${bx.toFixed(1)},${by.toFixed(1)} q${(-1.2 * s).toFixed(1)},${(-0.9 * s).toFixed(1)} ${(-2.4 * s).toFixed(1)},0" stroke="${p.dark}" stroke-width="0.25" fill="none" opacity="0.5"/>`
  }
  // Dunes : 4 couches de courbes superposées
  for (let layer = 0; layer < 4; layer++) {
    const baseY = 58 + layer * 11
    const light = 55 - layer * 12
    let path = `M0,100 L0,${baseY.toFixed(1)}`
    for (let x = 0; x <= 100; x += 20) {
      const peak = baseY - between(rng, 2, 9 - layer)
      path += ` Q${(x + 10).toFixed(1)},${peak.toFixed(1)} ${Math.min(100, x + 20).toFixed(1)},${(baseY + between(rng, -3, 3)).toFixed(1)}`
    }
    path += ' L100,100 Z'
    out += `<path d="${path}" fill="${hsl(p.accent + layer * 4, between(rng, 38, 55), light)}"/>`
    // Crête ensoleillée
    out += `<path d="${path.replace(' Z', '')}" fill="none" stroke="${hsl(45, 90, 75)}" stroke-width="0.2" opacity="${(0.35 - layer * 0.07).toFixed(2)}"/>`
  }
  // Cactus au premier plan
  const cactusCount = intBetween(rng, 1, 3)
  for (let i = 0; i < cactusCount; i++) {
    const cx = between(rng, 8, 92)
    const ch = between(rng, 8, 16)
    const baseY = between(rng, 92, 98)
    const green = hsl(105 + between(rng, -12, 12), 35, between(rng, 18, 28))
    out += `<rect x="${(cx - 0.8).toFixed(1)}" y="${(baseY - ch).toFixed(1)}" width="1.6" height="${ch.toFixed(1)}" rx="0.8" fill="${green}"/>`
    // Bras gauche / droit
    if (rng() > 0.35) {
      const armY = baseY - ch * between(rng, 0.5, 0.8)
      out += `<rect x="${(cx - 2.6).toFixed(1)}" y="${armY.toFixed(1)}" width="1.8" height="0.9" rx="0.45" fill="${green}"/>`
      out += `<rect x="${(cx - 2.6).toFixed(1)}" y="${(armY - 2.4).toFixed(1)}" width="0.9" height="2.6" rx="0.45" fill="${green}"/>`
    }
    if (rng() > 0.5) {
      const armY = baseY - ch * between(rng, 0.4, 0.7)
      out += `<rect x="${(cx + 0.8).toFixed(1)}" y="${armY.toFixed(1)}" width="1.8" height="0.9" rx="0.45" fill="${green}"/>`
      out += `<rect x="${(cx + 1.7).toFixed(1)}" y="${(armY - 2).toFixed(1)}" width="0.9" height="2.2" rx="0.45" fill="${green}"/>`
    }
  }
  return out
}

/** Style « neige » : sapins poudrés, chute de flocons, lueur froide. */
function drawSnow(rng: RNG, p: Palette, w: number, h: number): string {
  const cold: Palette = { name: p.name, sky: ['#0b1826', '#a8c3d9'], accent: 205, ground: 210, dark: '#060d14' }
  const moonX = between(rng, 65, 82)
  const moonY = between(rng, 12, 24)
  let out = skyGradient('sky', cold)
  // Lune froide + halo
  out += `<circle cx="${moonX.toFixed(1)}%" cy="${moonY.toFixed(1)}%" r="6%" fill="#eef5fb" opacity="0.9"/>`
  out += `<circle cx="${moonX.toFixed(1)}%" cy="${moonY.toFixed(1)}%" r="10%" fill="#eef5fb" opacity="0.12"/>`
  // Collines enneigées
  for (let layer = 0; layer < 3; layer++) {
    const baseY = 62 + layer * 12
    const light = 82 - layer * 18
    let path = `M0,100 L0,${baseY}`
    for (let x = 0; x <= 100; x += 16) {
      path += ` Q${(x + 8).toFixed(1)},${(baseY - between(rng, 3, 10)).toFixed(1)} ${Math.min(100, x + 16).toFixed(1)},${(baseY + between(rng, -2, 2)).toFixed(1)}`
    }
    path += ' L100,100 Z'
    out += `<path d="${path}" fill="${hsl(210, 25, light)}"/>`
  }
  // Sapins poudrés
  for (let i = 0; i < intBetween(rng, 6, 10); i++) {
    const x = between(rng, 3, 97)
    const baseY = between(rng, 78, 96)
    const th = between(rng, 10, 22)
    const tw = th * between(rng, 0.38, 0.5)
    out += `<rect x="${(x - tw * 0.05).toFixed(1)}" y="${(baseY - th * 0.18).toFixed(1)}" width="${(tw * 0.1).toFixed(1)}" height="${(th * 0.2).toFixed(1)}" fill="${hsl(28, 30, 14)}"/>`
    for (let s = 0; s < 3; s++) {
      const segTop = baseY - th + (s * th) / 3.1
      const segWidth = tw * (0.45 + s * 0.3)
      const segBottom = segTop + th / 2.5
      out += `<path d="M${x.toFixed(1)},${segTop.toFixed(1)} L${(x - segWidth / 2).toFixed(1)},${segBottom.toFixed(1)} L${(x + segWidth / 2).toFixed(1)},${segBottom.toFixed(1)} Z" fill="${hsl(205, 30, 16 + s * 4)}"/>`
      // Neige posée sur chaque étage
      out += `<path d="M${x.toFixed(1)},${segTop.toFixed(1)} L${(x - segWidth / 2).toFixed(1)},${segBottom.toFixed(1)} L${(x - segWidth * 0.3).toFixed(1)},${segBottom.toFixed(1)} L${x.toFixed(1)},${(segTop + 1).toFixed(1)} L${(x + segWidth * 0.3).toFixed(1)},${segBottom.toFixed(1)} L${(x + segWidth / 2).toFixed(1)},${segBottom.toFixed(1)} Z" fill="#eef5fb" opacity="0.85"/>`
    }
  }
  // Flocons
  for (let i = 0; i < 70; i++) {
    out += `<circle cx="${between(rng, 0, 100).toFixed(1)}" cy="${between(rng, 0, 100).toFixed(1)}" r="${between(rng, 0.15, 0.5).toFixed(2)}" fill="white" opacity="${between(rng, 0.3, 0.9).toFixed(2)}"/>`
  }
  return out
}

// ── Post-traitement cinématographique (tous styles) ──────────────────────

/**
 * Couche finale appliquée à chaque image : rayons de lumière volumétriques,
 * bokeh de profondeur, vignettage, étalonnage coloré et grain de film.
 * C'est ce qui donne aux compositions procédurales un rendu moins « plat ».
 */
function postProcess(rng: RNG, p: Palette, style: string): string {
  let out = ''

  // Rayons de lumière volumétriques depuis le haut (sauf pixel/logo)
  if (style !== 'pixel' && style !== 'logo') {
    const rays = intBetween(rng, 3, 5)
    out += '<g>'
    for (let i = 0; i < rays; i++) {
      const x = between(rng, 10, 90)
      const wd = between(rng, 3, 9)
      const tilt = between(rng, -14, 14)
      out += `<polygon points="${x.toFixed(1)},-5 ${(x + wd).toFixed(1)},-5 ${(x + wd + tilt).toFixed(1)},105 ${(x + tilt).toFixed(1)},105" fill="white" opacity="${between(rng, 0.03, 0.08).toFixed(3)}"/>`
    }
    out += '</g>'
  }

  // Bokeh de profondeur : disques flous lumineux (avant-plan)
  if (style !== 'pixel' && style !== 'logo') {
    out += '<g>'
    for (let i = 0; i < 7; i++) {
      const bx = between(rng, 5, 95)
      const by = between(rng, 20, 80)
      const r = between(rng, 1.2, 4)
      out += `<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="${r.toFixed(1)}" fill="${hsl(p.accent, 85, 75)}" opacity="${between(rng, 0.05, 0.14).toFixed(3)}"/>`
    }
    out += '</g>'
  }

  // Étalonnage coloré : voile froid en haut + teinte d'accent en bas
  out += `<rect width="100%" height="55%" fill="${hsl((p.accent + 180) % 360, 40, 60)}" opacity="0.045"/>`
  out += `<rect y="55%" width="100%" height="45%" fill="${hsl(p.accent, 70, 35)}" opacity="0.07"/>`

  // Vignettage (bordures assombries)
  out += `<defs><radialGradient id="vig" cx="50%" cy="46%" r="75%"><stop offset="62%" stop-color="black" stop-opacity="0"/><stop offset="100%" stop-color="black" stop-opacity="0.42"/></radialGradient></defs>`
  out += `<rect width="100%" height="100%" fill="url(#vig)"/>`

  // Grain de film : micro-points aléatoires
  out += '<g>'
  for (let i = 0; i < 90; i++) {
    out += `<rect x="${between(rng, 0, 100).toFixed(2)}" y="${between(rng, 0, 100).toFixed(2)}" width="0.18" height="0.18" fill="white" opacity="${between(rng, 0.02, 0.06).toFixed(3)}"/>`
  }
  out += '</g>'

  return out
}

/** Génère l'œuvre procédurale correspondant au prompt (graine = hash du prompt).
 *  `variant` permet de demander une AUTRE déclinaison du même prompt
 *  (même style/palette de base, composition différente). */
export function generateArt(prompt: string, sizeHint?: EntitiesSize, variant = 0): GeneratedArt {
  const seed = hashString(prompt.toLowerCase().trim() + (variant > 0 ? `#v${variant}` : ''))
  const rng = mulberry32(seed)
  const styleHint = detectStyle(prompt) ?? undefined
  const palette_ = palette(rng, styleHint, prompt)
  const landscape = (sizeHint ?? '1024x1024') === '1344x768'
  const portrait = (sizeHint ?? '1024x1024') === '768x1344'
  const width = landscape ? 1344 : portrait ? 768 : 1024
  const height = landscape ? 768 : portrait ? 1344 : 1024

  const style = styleHint ?? choice(rng, ['paysage', 'ville', 'foret', 'espace', 'ocean', 'abstrait', 'kawaii', 'desert', 'neige', 'aurore', 'cascade'] as const)

  let inner: string
  if (style === 'logo') {
    const label = prompt.replace(/logo|pour|de|mon|ma|d[eu']|g[ée]n[èe]rer?|cree|r?|fais/gi, ' ').replace(/\s+/g, ' ').trim() || 'nexus'
    inner = drawLogo(rng, palette_, label, width, height)
  } else {
    const drawers: Record<string, (r: RNG, p: Palette, w: number, h: number) => string> = {
      paysage: drawLandscape,
      ville: drawCity,
      foret: drawForest,
      espace: drawSpace,
      ocean: drawOcean,
      abstrait: drawAbstract,
      kawaii: drawKawaii,
      pixel: drawPixel,
      desert: drawDesert,
      neige: drawSnow,
      aurore: drawAurora,
      cascade: drawCascade,
    }
    inner = drawers[style](rng, palette_, width, height)
  }

  // Extras pilotés par le PROMPT : oiseaux, arc-en-ciel, bateau, phare…
  const tExtras = normalize(prompt)
  if (!['logo', 'pixel', 'abstrait', 'kawaii', 'espace'].includes(style)) {
    if (/oiseau|oiseaux|bird|mouette|corbeau/.test(tExtras)) inner += birdsFlock(rng)
    if (/arc.?en.?ciel|rainbow/.test(tExtras)) inner += rainbow(rng)
    if (/bateau|voilier|barque|sailboat|jonque/.test(tExtras) && style !== 'ville') inner += sailboat(rng, palette_, style === 'cascade' ? 90 : 74)
    if (/phare|lighthouse|c[ôo]te|falaise/.test(tExtras) && style !== 'ville') inner += lighthouse(rng, palette_)
  }

  // Post-traitement cinématographique commun : rayons de lumière, bokeh,
  // vignettage, étalonnage coloré et grain — pour un rendu plus riche.
  const post = postProcess(rng, palette_, style)

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">${inner}${post}</svg>`

  return {
    svg,
    style,
    seed,
    width,
    height,
    description: `${STYLE_LABELS[style] ?? style} · palette « ${palette_.name} » · graine ${seed % 100000}${variant > 0 ? ` · variante ${variant}` : ''}`,
  }
}

type EntitiesSize = '1024x1024' | '1344x768' | '768x1344'
