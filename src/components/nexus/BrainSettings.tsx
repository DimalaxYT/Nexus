'use client'

import { BookOpen, Brain, Globe2, RotateCcw, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useNexusStore } from '@/lib/store'
import {
  BRAIN_RESPONSE_DETAILS,
  BRAIN_WEB_RESEARCH_OPTIONS,
  type BrainResponseDetail,
  type BrainWebResearch,
} from '@/lib/brain/parameters'

export function BrainSettings() {
  const parameters = useNexusStore((state) => state.brainParameters)
  const setParameters = useNexusStore((state) => state.setBrainParameters)
  const resetParameters = useNexusStore((state) => state.resetBrainParameters)
  const detail = BRAIN_RESPONSE_DETAILS.find((option) => option.value === parameters.responseDetail) ?? BRAIN_RESPONSE_DETAILS[1]
  const webMode = BRAIN_WEB_RESEARCH_OPTIONS.find((option) => option.value === parameters.webResearch) ?? BRAIN_WEB_RESEARCH_OPTIONS[0]

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col gap-6 px-5 py-8 md:px-8 md:py-10">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-cyan-500 shadow-lg shadow-violet-500/20">
              <Brain className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-violet-300">
                <SlidersHorizontal className="h-3.5 w-3.5" /> Réglages du cerveau
              </p>
              <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">Paramètres d’intelligence</h1>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Ajuste la profondeur, les sources et la personnalisation du raisonnement local de NEXUS.
              </p>
            </div>
          </div>
          <Button variant="outline" onClick={resetParameters} className="shrink-0 gap-2">
            <RotateCcw className="h-4 w-4" /> Réinitialiser
          </Button>
        </header>

        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
          Ces réglages modifient les outils locaux de NEXUS, pas un modèle génératif. Ils sont enregistrés dans ce navigateur et appliqués aux prochains messages.
        </div>

        <Card className="border-border/80 bg-card/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <SlidersHorizontal className="h-4 w-4 text-violet-400" /> Profondeur des réponses
            </CardTitle>
            <CardDescription>Choisis combien d’éléments le moteur local récupère et affiche.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-7">
            <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <Label htmlFor="response-detail">Niveau de détail</Label>
                <p className="text-xs text-muted-foreground">{detail.description}</p>
              </div>
              <Select
                value={parameters.responseDetail}
                onValueChange={(value) => setParameters({ responseDetail: value as BrainResponseDetail })}
              >
                <SelectTrigger id="response-detail" className="w-full sm:w-56">
                  <SelectValue placeholder="Choisir un niveau" />
                </SelectTrigger>
                <SelectContent>
                  {BRAIN_RESPONSE_DETAILS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </section>

            <section className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <Label htmlFor="note-limit">Notes personnelles récupérées</Label>
                  <p className="text-xs text-muted-foreground">Maximum de notes locales jointes à une réponse générale.</p>
                </div>
                <span className="min-w-8 rounded-md border border-border bg-muted px-2 py-1 text-center text-sm font-semibold tabular-nums text-foreground">
                  {parameters.noteLimit}
                </span>
              </div>
              <Slider
                id="note-limit"
                min={1}
                max={5}
                step={1}
                value={[parameters.noteLimit]}
                onValueChange={([value]) => value !== undefined && setParameters({ noteLimit: value })}
                aria-label="Nombre maximal de notes personnelles"
              />
              <div className="flex justify-between text-[11px] text-muted-foreground"><span>1 note</span><span>5 notes</span></div>
            </section>
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe2 className="h-4 w-4 text-cyan-400" /> Recherche et mémoire
            </CardTitle>
            <CardDescription>Contrôle les sources externes et les informations personnelles réutilisées.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-7">
            <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <Label htmlFor="web-research">Recherche Web automatique</Label>
                <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">{webMode.description}</p>
              </div>
              <Select
                value={parameters.webResearch}
                onValueChange={(value) => setParameters({ webResearch: value as BrainWebResearch })}
              >
                <SelectTrigger id="web-research" className="w-full sm:w-56">
                  <SelectValue placeholder="Choisir un mode" />
                </SelectTrigger>
                <SelectContent>
                  {BRAIN_WEB_RESEARCH_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </section>

            <section className="flex items-center justify-between gap-4 rounded-xl border border-border/70 bg-muted/30 p-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
                  <BookOpen className="h-4 w-4" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="personal-memory">Personnalisation par la mémoire</Label>
                  <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
                    Utilise les souvenirs pertinents sur tes projets et préférences. Tes notes de connaissances restent consultables même si cette option est désactivée.
                  </p>
                </div>
              </div>
              <Switch
                id="personal-memory"
                checked={parameters.usePersonalMemory}
                onCheckedChange={(checked) => setParameters({ usePersonalMemory: checked })}
                aria-label="Activer la personnalisation par la mémoire"
              />
            </section>
          </CardContent>
        </Card>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />
          Les paramètres sont sauvegardés automatiquement sur cet appareil. « Jamais automatiquement » n’empêche pas une recherche Web explicitement demandée.
        </div>
      </div>
    </div>
  )
}
