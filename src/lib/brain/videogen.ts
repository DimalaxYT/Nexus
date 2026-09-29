// ─── NEXUS Brain — Moteur vidéo procédural (MP4 réel, 100 % local) ───────────
// Rendu image par image en TypeScript pur (buffers RGB) + encodage ffmpeg
// (libx264, rawvideo sur stdin). Aucune API externe : le « tournage » est un
// petit moteur de rendu 2D avec parallaxe, ciel animé, eau, particules,
// grain et fondu — même prompt = même film (graine déterministe).

import { spawn } from 'child_process'
import { mkdir, readdir, stat, unlink } from 'fs/promises'
import path from 'path'
import { hashString, mulberry32, normalize } from './text'

type RNG = () => number

export interface VideoOptions {
  duration?: number // 5 ou 10 secondes
  quality?: 'speed' | 'quality'
  variant?: number
}

export interface VideoResult {
  filePath: string
  fileName: string
  url: string // /api/tools/video/file?id=…
  id: string
  width: number
  height: number
  fps: number
  frames: number
  theme: string
  description: string
  ms: number
}

const between = (rng: RNG, a: number, b: number) => a + rng() * (b - a)

// ── Thèmes ────────────────────────────────────────────────────────────────────

interface Theme {
  id: string
  label: string
  skyTop: [number, number, number]
  skyMid: [number, number, number]
  skyLow: [number, number, number]
  sun: [number, number, number]
  sunY: number // 0 haut → 1 bas
  night: boolean
  water: boolean // plan d'eau à l'horizon
  waterColor?: [number, number, number]
  terrainHue: number
  fog: [number, number, number]
  stars: number // densité
}

function themeFor(prompt: string, rng: RNG): Theme {
  const t = normalize(prompt)
  const has = (re: RegExp) => re.test(t)

  if (has(/aurore|bor[eé]al|nordique|northern/)) {
    return { id: 'aurore', label: 'aurore boréale', skyTop: [4, 8, 24], skyMid: [8, 16, 42], skyLow: [16, 34, 66], sun: [180, 220, 255], sunY: 0.16, night: true, water: true, waterColor: [10, 26, 48], terrainHue: 215, fog: [24, 48, 84], stars: 1 }
  }
  if (has(/espace|galaxie|n[ée]buleuse|plan[èe]te|cosmos|univers|astronaute|fusee|fus[ée]e|orbite/)) {
    return { id: 'espace', label: 'voyage spatial', skyTop: [2, 1, 10], skyMid: [24, 6, 48], skyLow: [56, 14, 84], sun: [255, 214, 160], sunY: 0.3, night: true, water: false, terrainHue: 280, fog: [90, 40, 140], stars: 3 }
  }
  if (has(/ville|city|urbain|gratte.?ciel|metropole|cyberpunk|neon|n[ée]on|downtown|cit[ée]/)) {
    return { id: 'ville', label: 'ville en mouvement', skyTop: [8, 4, 26], skyMid: [64, 18, 80], skyLow: [232, 96, 60], sun: [255, 120, 60], sunY: 0.62, night: false, water: false, terrainHue: 265, fog: [70, 30, 90], stars: 0.4 }
  }
  if (has(/ocean|oc[ée]an|mer|vague|maritime|c[ôo]te|voilier|bateau|nautique/)) {
    return { id: 'ocean', label: 'océan infini', skyTop: [12, 30, 64], skyMid: [70, 130, 190], skyLow: [250, 190, 130], sun: [255, 214, 140], sunY: 0.5, night: false, water: true, waterColor: [24, 70, 110], terrainHue: 200, fog: [180, 200, 220], stars: 0 }
  }
  if (has(/foret|for[eê]t|jungle|bois|sylve|arbre|chenes|sapins/)) {
    return { id: 'foret', label: 'forêt brumeuse', skyTop: [10, 26, 34], skyMid: [70, 140, 120], skyLow: [220, 240, 190], sun: [255, 240, 190], sunY: 0.34, night: false, water: false, terrainHue: 135, fog: [170, 210, 180], stars: 0 }
  }
  if (has(/desert|dune|sable|cactus|oasis|sahara|mirage/)) {
    return { id: 'desert', label: 'dunes de désert', skyTop: [40, 14, 44], skyMid: [220, 90, 50], skyLow: [255, 190, 90], sun: [255, 170, 70], sunY: 0.44, night: false, water: false, terrainHue: 30, fog: [240, 160, 90], stars: 0 }
  }
  if (has(/neige|hiver|glace|arctique|banquise|blizzard|polaire/)) {
    return { id: 'neige', label: 'plaine enneigée', skyTop: [26, 44, 74], skyMid: [120, 160, 200], skyLow: [220, 234, 246], sun: [235, 242, 252], sunY: 0.3, night: false, water: false, terrainHue: 210, fog: [210, 224, 240], stars: 0 }
  }
  if (has(/pluie|orage|tempete|averse|brume|bruine/)) {
    return { id: 'pluie', label: 'averse sur les collines', skyTop: [18, 24, 34], skyMid: [52, 66, 82], skyLow: [110, 124, 138], sun: [200, 210, 220], sunY: 0.4, night: false, water: false, terrainHue: 200, fog: [120, 134, 148], stars: 0 }
  }
  if (has(/nuit|etoile|lune|lunaire|nocturne/) && !has(/filante/)) {
    return { id: 'nuit', label: 'nuit étoilée', skyTop: [3, 5, 16], skyMid: [10, 18, 44], skyLow: [30, 44, 84], sun: [220, 228, 255], sunY: 0.22, night: true, water: true, waterColor: [12, 22, 46], terrainHue: 220, fog: [40, 56, 100], stars: 1.6 }
  }
  if (rng() > 0.55) {
    return { id: 'aurore', label: 'aurore boréale', skyTop: [4, 8, 24], skyMid: [8, 16, 42], skyLow: [16, 34, 66], sun: [180, 220, 255], sunY: 0.16, night: true, water: true, waterColor: [10, 26, 48], terrainHue: 215, fog: [24, 48, 84], stars: 1 }
  }
  return { id: 'montagne', label: 'montagnes au crépuscule', skyTop: [16, 14, 50], skyMid: [120, 60, 110], skyLow: [255, 150, 90], sun: [255, 170, 90], sunY: 0.56, night: false, water: true, waterColor: [40, 40, 84], terrainHue: 260, fog: [190, 120, 130], stars: 0.25 }
}

// ── Bruit de valeur 2D (fbm) ─────────────────────────────────────────────────

function makeNoise(seed: number) {
  const perm = new Uint8Array(512)
  const src = new Uint8Array(256)
  for (let i = 0; i < 256; i++) src[i] = i
  const rng = mulberry32(seed ^ 0x9e3779b9)
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = src[i] as number
    src[i] = src[j] as number
    src[j] = tmp
  }
  for (let i = 0; i < 512; i++) perm[i] = src[i & 255] as number
  const fade = (t: number) => t * t * (3 - 2 * t)
  const grad = (hash: number) => (hash & 1 ? 1 : -1) * (0.5 + (hash >> 3) / 32)
  const noise2 = (x: number, y: number): number => {
    const xi = Math.floor(x) & 255
    const yi = Math.floor(y) & 255
    const xf = x - Math.floor(x)
    const yf = y - Math.floor(y)
    const u = fade(xf)
    const v = fade(yf)
    const aa = perm[perm[xi] + yi] as number
    const ab = perm[perm[xi] + yi + 1] as number
    const ba = perm[perm[xi + 1] + yi] as number
    const bb = perm[perm[xi + 1] + yi + 1] as number
    const x1 = grad(aa) * (1 - u) + grad(ba) * u
    const x2 = grad(ab) * (1 - u) + grad(bb) * u
    return (x1 * (1 - v) + x2 * v) * 0.5 + 0.5
  }
  const fbm = (x: number, y: number, oct = 3): number => {
    let amp = 0.55
    let freq = 1
    let sum = 0
    let norm = 0
    for (let o = 0; o < oct; o++) {
      sum += noise2(x * freq, y * freq) * amp
      norm += amp
      amp *= 0.5
      freq *= 2.1
    }
    return sum / norm
  }
  return { noise2, fbm }
}

// ── Aides dessin ─────────────────────────────────────────────────────────────

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)
const mix = (a: number, b: number, t: number) => a + (b - a) * t

class Frame {
  data: Uint8Array
  constructor(public w: number, public h: number) {
    this.data = new Uint8Array(w * h * 3)
  }
  set(x: number, y: number, r: number, g: number, b: number) {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return
    const i = (y * this.w + x) * 3
    this.data[i] = clamp255(r)
    this.data[i + 1] = clamp255(g)
    this.data[i + 2] = clamp255(b)
  }
  add(x: number, y: number, r: number, g: number, b: number, a: number) {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return
    const i = (y * this.w + x) * 3
    this.data[i] = clamp255(this.data[i]! + r * a)
    this.data[i + 1] = clamp255(this.data[i + 1]! + g * a)
    this.data[i + 2] = clamp255(this.data[i + 2]! + b * a)
  }
  disc(cx: number, cy: number, r: number, col: [number, number, number], a = 1, glow = 0) {
    const x0 = Math.floor(cx - r - glow)
    const x1 = Math.ceil(cx + r + glow)
    const y0 = Math.max(0, Math.floor(cy - r - glow))
    const y1 = Math.min(this.h - 1, Math.ceil(cy + r + glow))
    for (let y = y0; y <= y1; y++) {
      for (let x = Math.max(0, x0); x <= Math.min(this.w - 1, x1); x++) {
        const dx = x - cx
        const dy = y - cy
        const d = Math.sqrt(dx * dx + dy * dy)
        if (d <= r) this.add(x, y, col[0], col[1], col[2], a)
        else if (glow > 0 && d <= r + glow) this.add(x, y, col[0], col[1], col[2], a * (1 - (d - r) / glow) * 0.35)
      }
    }
  }
}

// ── Terrain : cartes de hauteur par colonne ──────────────────────────────────

function heightmap(noise: ReturnType<typeof makeNoise>, width: number, seedOff: number, baseY: number, amp: number, rough: number): Float32Array {
  const map = new Float32Array(width)
  for (let x = 0; x < width; x++) {
    const n = noise.fbm((x + seedOff * 977) * 0.004 * rough, seedOff * 3.7, 4)
    map[x] = baseY - (n - 0.42) * amp
  }
  return map
}

// ── Moteur de scène ──────────────────────────────────────────────────────────

interface Star { x: number; y: number; r: number; ph: number; sp: number }

export async function renderVideo(prompt: string, opts: VideoOptions = {}): Promise<VideoResult> {
  const t0 = Date.now()
  const seed = hashString(prompt.toLowerCase().trim() + (opts.variant && opts.variant > 0 ? `#v${opts.variant}` : ''))
  const rng = mulberry32(seed)
  const theme = themeFor(prompt, rng)
  const noise = makeNoise(seed)
  const noise2 = makeNoise(seed ^ 0x51ed270b)

  const quality = opts.quality === 'quality'
  const W = quality ? 960 : 640
  const H = quality ? 540 : 360
  const FPS = 24
  const duration = opts.duration === 10 ? 10 : 5
  const frames = duration * FPS
  const horizon = Math.round(H * (theme.water ? 0.62 : 0.66))

  // Étoiles précalculées
  const starCount = Math.round(140 * theme.stars)
  const stars: Star[] = []
  for (let i = 0; i < starCount; i++) {
    stars.push({ x: rng() * W, y: rng() * horizon * 0.95, r: between(rng, 0.4, 1.3), ph: rng() * 6.28, sp: between(rng, 1.5, 4) })
  }

  // Terrain : 3 couches parallaxe (cartes plus larges que l'écran pour le travelling)
  const panAmp = quality ? 34 : 26
  const MAPW = W + panAmp * 2 + 4
  const layers = [
    { map: heightmap(noise, MAPW, 11 + seed % 50, horizon - H * 0.16, H * 0.34, 0.8), speed: 0.25, shade: 0.34 },
    { map: heightmap(noise, MAPW, 37 + seed % 80, horizon - H * 0.07, H * 0.26, 1.15), speed: 0.55, shade: 0.24 },
    { map: heightmap(noise, MAPW, 83 + seed % 110, horizon + H * 0.02, H * 0.17, 1.5), speed: 1.0, shade: 0.13 },
  ]

  // Nuages : positions précalculées en grille de bruit (advection par offset temporel)
  const cloudSeed = seed % 999
  const buildings: { x: number; w: number; h: number; hue: number; win: number[] }[] = []
  if (theme.id === 'ville') {
    let bx = -10
    while (bx < MAPW) {
      const bw = between(rng, 26, 70)
      const bh = between(rng, H * 0.18, H * 0.52)
      const win: number[] = []
      const cols = Math.floor(bw / 9)
      const rows = Math.floor(bh / 11)
      for (let i = 0; i < cols * rows; i++) win.push(rng() < 0.42 ? (rng() < 0.82 ? 1 : 2) : 0)
      buildings.push({ x: bx, w: bw, h: bh, hue: rng() < 0.3 ? 190 : rng() < 0.5 ? 45 : 320, win })
      bx += bw + between(rng, 4, 18)
    }
  }

  // Particules (pluie / neige / lucioles / braises / bulles)
  interface P { x: number; y: number; vx: number; vy: number; s: number; ph: number }
  const particles: P[] = []
  const pKind = theme.id === 'pluie' ? 'pluie' : theme.id === 'neige' ? 'neige' : theme.night && theme.id !== 'espace' ? (rng() > 0.4 ? 'lucioles' : 'aucune') : 'aucune'
  if (pKind !== 'aucune') {
    const n = pKind === 'pluie' ? 190 : pKind === 'neige' ? 150 : 26
    for (let i = 0; i < n; i++) {
      particles.push({ x: rng() * W, y: rng() * H, vx: between(rng, -8, 8), vy: pKind === 'pluie' ? between(rng, 300, 520) : pKind === 'neige' ? between(rng, 26, 70) : between(rng, -10, 10), s: between(rng, 0.6, 2.2), ph: rng() * 6.28 })
    }
  }

  // Oiseaux : petites volées lointaines
  const birds: { x: number; y: number; v: number; s: number; ph: number }[] = []
  if (!theme.night && theme.id !== 'espace' && theme.id !== 'ville') {
    for (let i = 0; i < 7; i++) {
      birds.push({ x: rng() * W, y: between(rng, H * 0.16, horizon - H * 0.14), v: between(rng, 22, 48) * (rng() > 0.5 ? 1 : -1), s: between(rng, 2.2, 4.4), ph: rng() * 6.28 })
    }
  }

  const sunX0 = W * between(rng, 0.24, 0.76)
  const skyLUT = new Float32Array(H * 3)
  const vignette = new Float32Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = (x / W - 0.5) * 2.1
      const ny = (y / H - 0.5) * 2.1
      const d = Math.sqrt(nx * nx + ny * ny * 1.12)
      vignette[y * W + x] = d > 1 ? Math.max(0.42, 1 - (d - 1) * 0.62) : 1
    }
  }

  const LERP_T = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]

  function skyAt(y: number): [number, number, number] {
    const v = y / horizon
    if (v < 0.55) return LERP_T(theme.skyTop, theme.skyMid, v / 0.55)
    return LERP_T(theme.skyMid, theme.skyLow, (v - 0.55) / 0.45)
  }

  function renderFrame(f: number): Uint8Array {
    const time = f / FPS
    const prog = f / frames
    const frame = new Frame(W, H)
    const camX = (Math.sin(prog * Math.PI) * 0.7 + prog) * panAmp // travelling avant léger

    // Ciel (LUT par ligne)
    for (let y = 0; y < horizon; y++) {
      const [r, g, b] = skyAt(y)
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 3
        frame.data[i] = r
        frame.data[i + 1] = g
        frame.data[i + 2] = b
      }
    }

    // Étoiles scintillantes
    if (theme.stars > 0) {
      for (const st of stars) {
        const tw = 0.55 + 0.45 * Math.sin(time * st.sp + st.ph)
        frame.add(Math.round(st.x), Math.round(st.y), 255, 250, 235, tw * 0.9)
        if (st.r > 1) {
          frame.add(Math.round(st.x) + 1, Math.round(st.y), 255, 250, 235, tw * 0.4)
          frame.add(Math.round(st.x) - 1, Math.round(st.y), 255, 250, 235, tw * 0.4)
          frame.add(Math.round(st.x), Math.round(st.y) + 1, 255, 250, 235, tw * 0.4)
          frame.add(Math.round(st.x), Math.round(st.y) - 1, 255, 250, 235, tw * 0.4)
        }
      }
    }

    // Espace : nébuleuse fbm + planète + météorites
    if (theme.id === 'espace') {
      for (let y = 0; y < H; y += 2) {
        for (let x = 0; x < W; x += 2) {
          const n = noise2.fbm(x * 0.006 + time * 0.02, y * 0.006, 4)
          if (n > 0.56) {
            const intensity = (n - 0.56) * 2.4
            const col = n > 0.72 ? [255, 160, 220] : n > 0.64 ? [130, 90, 220] : [60, 90, 200]
            for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) frame.add(x + dx, y + dy, col[0]!, col[1]!, col[2]!, intensity * 0.16)
          }
        }
      }
      // Planète avec terminateur jour/nuit + anneau
      const px = W * 0.68 - camX * 0.12
      const py = H * 0.4
      const pr = H * 0.23
      const lightAngle = time * 0.12 + 2.2
      for (let y = Math.floor(py - pr); y <= py + pr; y++) {
        for (let x = Math.floor(px - pr); x <= px + pr; x++) {
          const dx = x - px
          const dy = y - py
          const d = Math.sqrt(dx * dx + dy * dy)
          if (d <= pr) {
            const nz = Math.sqrt(Math.max(0, pr * pr - dx * dx - dy * dy)) / pr
            const lx = Math.cos(lightAngle)
            const shade = Math.max(0, (dx * lx + dy * Math.sin(lightAngle) * 0.3) / pr) * 0.85 + nz * 0.3
            const band = noise.fbm(dx * 0.05, dy * 0.05 + time * 0.05, 3)
            const base = [90 + band * 90, 60 + band * 60, 160 + band * 70]
            frame.set(x, y, base[0]! * shade, base[1]! * shade * 0.9, base[2]! * shade)
          }
        }
      }
      // Anneau de Saturne : ellipse aplatie, cachée derrière la planète en haut
      const rx = pr * 1.62
      const ry = pr * 0.3
      for (let y = Math.floor(py - ry * 2.2); y <= py + ry * 2.2; y++) {
        for (let x = Math.floor(px - rx * 1.2); x <= px + rx * 1.2; x++) {
          const dx = (x - px) / rx
          const dy = (y - py) / ry
          const e = Math.sqrt(dx * dx + dy * dy)
          if (e > 0.92 && e < 1.12) {
            const inPlanet = Math.sqrt((x - px) * (x - px) + (y - py) * (y - py)) < pr
            if (inPlanet && y < py) continue // anneau derrière la planète (moitié haute)
            const bandA = 0.4 + 0.35 * noise.noise2(e * 40, y * 0.01)
            const edge = (1.12 - e) / 0.2
            frame.add(x, y, 226, 196, 148, bandA * Math.max(0, edge) * 0.7)
          }
        }
      }
      // Étoile filante périodique
      const cycle = (time % 4) / 4
      if (cycle < 0.12) {
        const sx = W * (0.15 + cycle * 3)
        const sy = H * 0.12 + cycle * H
        for (let k = 0; k < 26; k++) frame.add(Math.round(sx - k * 3), Math.round(sy - k * 1.4), 255, 255, 240, (1 - k / 26) * (1 - cycle / 0.12) * 0.9)
      }
    }

    // Aurores : rideaux ondulants (bandes verticales additives)
    if (theme.id === 'aurore') {
      for (let x = 0; x < W; x++) {
        const wave1 = Math.sin(x * 0.014 + time * 0.7) * H * 0.055 + Math.sin(x * 0.031 - time * 0.42) * H * 0.03
        const top = horizon * 0.28 + wave1
        const len = H * (0.3 + 0.12 * Math.sin(x * 0.02 + time * 0.5))
        const shimmer = 0.6 + 0.4 * Math.sin(x * 0.09 + time * 2.1)
        for (let k = 0; k < len; k += 1) {
          const y = Math.round(top + k)
          if (y >= horizon) break
          const fall = 1 - k / len
          const green = Math.sin(k / len * Math.PI)
          frame.add(x, y, 30 * green, 190 * fall * shimmer * green + 60 * fall, 130 * fall * (1 - green) + 90 * fall * green, 0.5 * fall * shimmer)
        }
      }
    }

    // Soleil / lune avec halo
    const sunX = sunX0 - camX * 0.06
    const sunY = horizon * theme.sunY + Math.sin(time * 0.1) * 2
    if (theme.id !== 'espace') {
      frame.disc(sunX, sunY, H * 0.045, theme.sun, 0.95, H * 0.16)
      if (theme.id === 'nuit' || theme.id === 'aurore') {
        // Cratères de lune
        frame.disc(sunX - 5, sunY - 3, 4, [190, 198, 226], 0.5)
        frame.disc(sunX + 6, sunY + 4, 3, [190, 198, 226], 0.4)
      }
    }

    // Nuages (fbm demi-résolution, advection + parallaxe)
    if (theme.id !== 'espace') {
      const cw = Math.ceil(W / 2)
      const ch = Math.ceil(horizon / 2)
      const drift = time * 9 + camX * 0.3
      for (let cy = 0; cy < ch; cy++) {
        for (let cx = 0; cx < cw; cx++) {
          const n = noise.fbm(cx * 0.02 + drift * 0.02, cy * 0.045 + cloudSeed * 0.01, 3)
          const cover = theme.id === 'pluie' ? 0.52 : theme.id === 'desert' ? 0.68 : 0.6
          if (n > cover) {
            const a = Math.min(0.8, (n - cover) * 2.6) * (1 - cy / ch * 0.55)
            const lit = 1 + (n - cover) * 1.8
            const base = skyAt(cy * 2)
            const cr = mix(base[0], theme.id === 'pluie' ? 70 : 255, 0.6) * lit
            const cg = mix(base[1], theme.id === 'pluie' ? 80 : 250, 0.6) * lit
            const cb = mix(base[2], theme.id === 'pluie' ? 95 : 248, 0.6) * lit
            for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) frame.add(cx * 2 + dx, cy * 2 + dy, cr, cg, cb, a * 0.32)
          }
        }
      }
    }

    // Montagnes (3 couches parallaxe, brume de distance)
    for (const layer of layers) {
      const off = Math.round(camX * layer.speed)
      for (let x = 0; x < W; x++) {
        const hx = Math.min(MAPW - 1, x + off)
        const top = Math.round(layer.map[hx]!)
        if (top >= H) continue
        const [r, g, b] = skyAt(Math.min(horizon - 1, top))
        const shade = layer.shade
        const rock = mix(r * shade, theme.terrainHue === 30 ? 190 : 46, shade)
        const rr = mix(r * 0.35 + rock * 0.65, theme.fog[0], 1 - layer.speed * 0.6)
        const gg = mix(g * 0.35 + rock * 0.55, theme.fog[1], 1 - layer.speed * 0.6)
        const bb = mix(b * 0.35 + rock * 0.75, theme.fog[2], 1 - layer.speed * 0.6)
        for (let y = Math.max(0, top); y < H; y++) {
          const i = (y * W + x) * 3
          frame.data[i] = clamp255(rr)
          frame.data[i + 1] = clamp255(gg)
          frame.data[i + 2] = clamp255(bb)
        }
        // Crête éclairée côté soleil
        if (top > 0 && top < horizon && sunX > x - 60 && sunX < x + 60) {
          frame.add(x, top, 255, 220, 180, 0.25)
        }
      }
    }

    // Ville : silhouettes + fenêtres + néons (remplace la 3e couche de montagne)
    if (theme.id === 'ville') {
      const off = Math.round(camX * 0.9)
      for (const b of buildings) {
        const bx = b.x - off
        if (bx + b.w < 0 || bx > W) continue
        const top = horizon + H * 0.03 - b.h
        for (let y = Math.max(0, Math.round(top)); y < Math.min(H, horizon + H * 0.04); y++) {
          for (let x = Math.max(0, Math.round(bx)); x < Math.min(W, bx + b.w); x++) {
            frame.set(x, y, 14, 12, 26)
          }
        }
        // Fenêtres allumées (grille, scintillement lent)
        const cols = Math.floor(b.w / 9)
        const rows = Math.floor(b.h / 11)
        for (let cyi = 0; cyi < rows; cyi++) {
          for (let cxi = 0; cxi < cols; cxi++) {
            const w = b.win[cyi * cols + cxi] ?? 0
            if (w === 0) continue
            const flick = Math.sin(time * 0.7 + (cyi * 7 + cxi * 13)) > -0.9 ? 1 : 0.2
            const wx = Math.round(bx + cxi * 9 + 3)
            const wy = Math.round(top + cyi * 11 + 5)
            const col = w === 2 ? [120, 220, 255] : [255, 200, 110]
            for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 2; dx++) frame.add(wx + dx, wy + dy, col[0]!, col[1]!, col[2]!, 0.75 * flick)
          }
        }
        // Bandeau néon au sommet
        const neon: [number, number, number] = b.hue === 190 ? [34, 211, 238] : b.hue === 45 ? [250, 204, 21] : [236, 72, 153]
        for (let x = Math.max(0, Math.round(bx)); x < Math.min(W, bx + b.w); x++) {
          frame.add(x, Math.round(top) + 1, neon[0], neon[1], neon[2], 0.8)
          frame.add(x, Math.round(top) + 2, neon[0], neon[1], neon[2], 0.4)
        }
      }
    }

    // Eau : reflet du ciel déformé + glitter solaire + lignes de vagues
    if (theme.water) {
      const wc = theme.waterColor ?? [20, 40, 80]
      for (let y = horizon; y < H; y++) {
        const depth = (y - horizon) / (H - horizon)
        const waveAmp = 1.6 + depth * 7
        for (let x = 0; x < W; x++) {
          const wob = Math.sin(x * 0.09 + time * 2.2 + depth * 9) * waveAmp + Math.sin(x * 0.023 - time * 1.1) * waveAmp * 0.6
          const srcY = Math.max(0, Math.round(horizon - (y - horizon) * 1.15 - 4 + wob))
          const [r, g, b] = srcY < horizon ? skyAt(srcY) : [theme.fog[0], theme.fog[1], theme.fog[2]]
          const wr = mix(r * 0.5, wc[0], 0.55)
          const wg = mix(g * 0.5, wc[1], 0.55)
          const wb = mix(b * 0.5, wc[2], 0.55)
          frame.set(x, y, wr, wg, wb)
          // Glitter : reflet du soleil scintillant (mouchetis hashé — pas de traînées)
          const sunDist = Math.abs(x - sunX)
          if (sunDist < W * 0.11 && rng2Frame(x * 131 + f * 17, y * 57 + depth * 31) > 0.955) {
            frame.add(x, y, 255, 230, 180, 0.55 * (1 - sunDist / (W * 0.11)))
          }
        }
        // Lignes de vagues subtiles
        if ((y - horizon) % 14 === 0) {
          for (let x = 0; x < W; x++) {
            if (Math.sin(x * 0.05 + time * 1.6 + y) > 0.3) frame.add(x, y, 255, 255, 255, 0.05)
          }
        }
      }
    }

    // Forêt : silhouettes de sapins qui glissent (premier plan)
    if (theme.id === 'foret') {
      const off = camX * 1.6
      for (let i = 0; i < 26; i++) {
        const tx = ((i * 137.5 + noise.noise2(i * 3.1, 7.7) * 90) % MAPW) - off
        const wrapped = tx < -30 ? tx + MAPW : tx
        const th = H * (0.16 + ((i * 53) % 11) / 60)
        const baseY = horizon + H * 0.05 + ((i * 29) % 5)
        const sway = Math.sin(time * 0.8 + i) * 1.2
        for (let s = 0; s < 14; s++) {
          const segTop = baseY - th + (s / 14) * th
          const segW = (th * 0.42) * (s / 14 + 0.15)
          const shade = 8 + s * 1.1
          for (let dx = -Math.ceil(segW); dx <= Math.ceil(segW); dx++) {
            const x = Math.round(wrapped + dx + sway * (s / 14))
            for (let y = Math.round(segTop); y < Math.round(segTop + th / 12); y++) {
              frame.set(x, y, shade * 0.6, shade, shade * 0.7)
            }
          }
        }
      }
    }

    // Désert : cactus de premier plan
    if (theme.id === 'desert') {
      const off = camX * 1.3
      for (let i = 0; i < 4; i++) {
        const cx = (((i * 293 + 60) % MAPW) - off + MAPW) % MAPW
        const baseY = horizon + H * 0.16 + i * 6
        const chh = H * 0.09 + (i % 3) * 8
        const green = 26 + i * 4
        for (let y = Math.round(baseY - chh); y < baseY; y++) {
          for (let dx = -3; dx <= 3; dx++) frame.set(Math.round(cx) + dx, y, green * 0.7, green + 40, green * 0.8)
        }
        for (let y = Math.round(baseY - chh * 0.7); y < Math.round(baseY - chh * 0.4); y++) {
          for (let dx = -9; dx < -4; dx++) frame.set(Math.round(cx) + dx, y, green * 0.7, green + 40, green * 0.8)
        }
      }
    }

    // Particules (pluie / neige / lucioles)
    if (pKind !== 'aucune') {
      for (const p of particles) {
        const py = (p.y + p.vy * time + p.ph * 40) % (H + 30)
        const px = ((p.x + p.vx * time + Math.sin(time + p.ph) * (pKind === 'neige' ? 14 : 2)) % W + W) % W
        if (pKind === 'pluie') {
          for (let k = 0; k < 7; k++) frame.add(Math.round(px), (Math.round(py) - k + H) % H, 180, 200, 230, 0.35 - k * 0.045)
        } else if (pKind === 'neige') {
          frame.add(Math.round(px), Math.round(py), 255, 255, 255, 0.75)
          if (p.s > 1.5) frame.add(Math.round(px) + 1, Math.round(py), 255, 255, 255, 0.4)
        } else {
          const glow = 0.5 + 0.5 * Math.sin(time * 2.4 + p.ph * 4)
          frame.disc(px, py, p.s + glow, [200, 255, 130], 0.8 * glow, 3)
        }
      }
    }

    // Oiseaux (battement d'ailes)
    for (const b of birds) {
      const bx = ((b.x + b.v * time) % (W + 40) + (W + 40)) % (W + 40) - 20
      const flap = Math.sin(time * 9 + b.ph)
      const by = b.y + Math.sin(time * 0.5 + b.ph) * 4
      const c = theme.night ? [200, 210, 240] : [30, 26, 40]
      for (let k = -b.s; k <= b.s; k++) {
        frame.add(Math.round(bx + k), Math.round(by - Math.abs(flap) * b.s * 0.6 * (1 - Math.abs(k) / b.s)), c[0]!, c[1]!, c[2]!, 0.7)
      }
    }

    // Post-traitement : vignette + grain + fondu
    const fadeIn = f < 14 ? f / 14 : 1
    const fadeOut = f > frames - 18 ? (frames - f) / 18 : 1
    const fade = Math.min(fadeIn, fadeOut)
    const grainN = quality ? 2200 : 1400
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const vi = vignette[y * W + x]!
        if (vi < 1) {
          const i = (y * W + x) * 3
          frame.data[i] = frame.data[i]! * vi
          frame.data[i + 1] = frame.data[i + 1]! * vi
          frame.data[i + 2] = frame.data[i + 2]! * vi
        }
      }
    }
    for (let g = 0; g < grainN; g++) {
      const gx = (rng2Frame(f, g) * W) | 0
      const gy = (rng2Frame(f, g + 7777) * H) | 0
      frame.add(gx, gy, 255, 255, 255, 0.045)
    }
    if (fade < 1) {
      for (let i = 0; i < frame.data.length; i++) frame.data[i] = frame.data[i]! * fade
    }
    return frame.data
  }

  // ── Encodage ffmpeg (rawvideo → libx264 mp4) ───────────────────────────────
  const id = `vid-${seed.toString(36)}${opts.variant && opts.variant > 0 ? `-v${opts.variant}` : ''}-${duration}s`
  const fileName = `${id}.mp4`
  const outDir = path.join(process.cwd(), 'public', 'generated', 'videos')
  await mkdir(outDir, { recursive: true })
  const filePath = path.join(outDir, fileName)

  // Nettoyage LRU automatique (garde au maximum les 30 dernières vidéos pour protéger le disque)
  try {
    const files = (await readdir(outDir)).filter((f) => f.endsWith('.mp4'))
    if (files.length > 30) {
      const stats = await Promise.all(
        files.map(async (f) => {
          const p = path.join(outDir, f)
          const st = await stat(p).catch(() => null)
          return { p, mtime: st?.mtimeMs ?? 0 }
        })
      )
      stats.sort((a, b) => b.mtime - a.mtime)
      for (const old of stats.slice(30)) {
        await unlink(old.p).catch(() => {})
      }
    }
  } catch {
    /* non bloquant */
  }

  await new Promise<void>((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-r', String(FPS), '-i', 'pipe:0',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', quality ? '20' : '23',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      filePath,
    ], { stdio: ['pipe', 'ignore', 'pipe'] })
    let err = ''
    ff.stderr.on('data', (d) => { err += String(d).slice(0, 2000) })
    ff.on('error', reject)
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg a échoué (${code}) : ${err.slice(0, 400)}`))))
    // Écriture des frames par paquets (back-pressure gérée par await drain)
    const stdin = ff.stdin!
    let fi = 0
    const writeNext = (): void => {
      while (fi < frames) {
        const data = renderFrame(fi)
        const buf = Buffer.from(data.buffer, data.byteOffset, data.length)
        fi++
        if (!stdin.write(buf)) {
          stdin.once('drain', writeNext)
          return
        }
      }
      stdin.end()
    }
    writeNext()
  })

  return {
    filePath,
    fileName,
    id,
    url: `/api/tools/video/file?id=${encodeURIComponent(id)}`,
    width: W,
    height: H,
    fps: FPS,
    frames,
    theme: theme.label,
    description: `${theme.label} · ${duration}s · ${W}×${H} · ${frames} images · graine ${seed % 100000}${opts.variant && opts.variant > 0 ? ` · variante ${opts.variant}` : ''}`,
    ms: Date.now() - t0,
  }
}

/** Petit PRNG déterministe pour le grain (stable par frame). */
function rng2Frame(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0
  h = ((h ^ (h >>> 13)) * 1274126177) | 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
