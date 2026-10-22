// Personnalisation du compte : nom, ton, consignes permanentes, avatar, thème…
// Ces réglages sont PROPRES À CHAQUE COMPTE et injectés dans le cerveau de NEXUS.

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, isValidEmail, parseProfile, publicUserJson } from '@/lib/auth'
import { invalidatePersonaCache } from '@/lib/llm/personalize'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TONES = ['neutre', 'chaleureux', 'professionnel', 'direct', 'pedagogue']
const HEX = /^#[0-9a-fA-F]{6}$/

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined)

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: 'Non connecté.' }, { status: 401 })

  const body = (await req.json().catch(() => null)) ?? {}
  const profile = parseProfile(
     
    (await db.user.findUnique({ where: { id: user.id } }))?.profile
  )

  const patch: Record<string, unknown> = {}

  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim().slice(0, 60)
  if (typeof body.email === 'string') {
    const email = body.email.trim().toLowerCase()
    if (!isValidEmail(email)) return Response.json({ error: 'Adresse e-mail invalide.' }, { status: 400 })
    if (email !== user.email.toLowerCase()) {
      const clash = await db.user.findUnique({ where: { email } })
      if (clash) return Response.json({ error: 'Cette adresse est déjà utilisée.' }, { status: 409 })
      patch.email = email
    }
  }

  const next: typeof profile = { ...profile }
  const displayName = str(body.displayName, 60)
  if (displayName !== undefined) next.displayName = displayName.trim()
  const assistantName = str(body.assistantName, 40)
  if (assistantName !== undefined) next.assistantName = assistantName.trim()
  if (typeof body.tone === 'string' && TONES.includes(body.tone)) next.tone = body.tone as typeof next.tone
  const bio = str(body.bio, 400)
  if (bio !== undefined) next.bio = bio.trim()
  const language = str(body.language, 20)
  if (language !== undefined) next.language = language.trim()
  const instructions = str(body.instructions, 2000)
  if (instructions !== undefined) next.instructions = instructions.trim()
  const greeting = str(body.greeting, 300)
  if (greeting !== undefined) next.greeting = greeting.trim()
  const company = str(body.company, 80)
  if (company !== undefined) next.company = company.trim()
  const website = str(body.website, 200)
  if (website !== undefined) next.website = website.trim()
  if (typeof body.avatarColor === 'string' && HEX.test(body.avatarColor)) next.avatarColor = body.avatarColor
  if (body.theme === 'dark' || body.theme === 'light') next.theme = body.theme
  // Apparence du compte : mode, palette et accent (chaînes courtes validées
  // côté client ; une valeur inconnue est ignorée à l'affichage).
  if (body.appearance && typeof body.appearance === 'object') {
    const raw = body.appearance as Record<string, unknown>
    const clean: NonNullable<typeof next.appearance> = {}
    if (raw.mode === 'light' || raw.mode === 'dark' || raw.mode === 'system') clean.mode = raw.mode
    if (typeof raw.accent === 'string' && /^[a-z]{3,24}$/.test(raw.accent)) clean.accent = raw.accent
    if (typeof raw.palette === 'string' && /^[a-z]{3,24}$/.test(raw.palette)) clean.palette = raw.palette
    if (Object.keys(clean).length) next.appearance = clean
  }

  patch.profile = JSON.stringify(next)

  try {
    const updated = await db.user.update({ where: { id: user.id }, data: patch })
    // Prénom / ton / nom de l'assistant viennent de changer : la personnalisation
    // en cache 30 s doit servir la nouvelle version dès le message suivant.
    invalidatePersonaCache(user.id)
    return Response.json({ ok: true, user: publicUserJson(updated) })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Mise à jour impossible' },
      { status: 500 }
    )
  }
}
