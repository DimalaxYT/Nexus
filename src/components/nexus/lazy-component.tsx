'use client'

// ─── NEXUS — Composants chargés à la demande, sans Suspense ──────────────────
// `next/dynamic` (comme `React.lazy`) suspend le rendu à la première
// apparition du composant, même quand son code est DÉJÀ téléchargé : React 19
// regroupe alors l'affichage des contenus suspendus par paliers de 300 ms.
// Résultat mesuré : un panneau préchargé mettait encore ~330 ms à s'ouvrir.
//
// Ici, le module est chargé (ou préchargé avec `preload()`) puis gardé en
// mémoire : s'il est prêt, le composant s'affiche immédiatement ; sinon un
// repli est montré le temps du téléchargement, puis un simple changement
// d'état affiche le composant — sans palier.
//
// Après un nouveau déploiement, un onglet resté ouvert peut réclamer un
// morceau de code qui n'existe plus : on propose alors de recharger la page
// au lieu d'afficher une zone vide.

import { useEffect, useState, type ComponentType, type ReactNode } from 'react'

export interface LazyComponent<P> {
  (props: P): ReactNode
  /** Télécharge le code du composant (sans l'afficher). */
  preload: () => Promise<void>
}

export function lazyComponent<P extends object>(
  loader: () => Promise<ComponentType<P>>,
  fallback: ReactNode = null
): LazyComponent<P> {
  let resolved: ComponentType<P> | null = null
  let pending: Promise<void> | null = null

  const preload = (): Promise<void> => {
    if (!pending) {
      pending = loader().then(
        (component) => {
          resolved = component
        },
        (err: unknown) => {
          pending = null // nouvelle tentative possible
          throw err
        }
      )
    }
    return pending
  }

  function Lazy(props: P) {
    const [Component, setComponent] = useState<ComponentType<P> | null>(() => resolved)
    const [failed, setFailed] = useState(false)

    useEffect(() => {
      if (Component) return
      let alive = true
      preload().then(
        () => {
          if (alive) setComponent(() => resolved)
        },
        () => {
          if (alive) setFailed(true)
        }
      )
      return () => {
        alive = false
      }
    }, [Component])

    if (Component) return <Component {...props} />
    if (failed) {
      return (
        <div className="flex h-full min-h-40 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Cette partie de l’application n’a pas pu être chargée (nouvelle version en ligne ?).
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-sm hover:bg-accent"
          >
            Recharger la page
          </button>
        </div>
      )
    }
    return <>{fallback}</>
  }

  Lazy.preload = preload
  return Lazy
}

/**
 * Lance `task` quand le navigateur est au repos, au plus tard `timeoutMs`
 * après `delayMs`. Renvoie une fonction d'annulation (pour un `useEffect`).
 */
export function whenIdle(task: () => void, delayMs: number, timeoutMs = 5000): () => void {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
    cancelIdleCallback?: (id: number) => void
  }
  let idleId: number | null = null
  const timer = setTimeout(() => {
    if (w.requestIdleCallback) idleId = w.requestIdleCallback(task, { timeout: timeoutMs })
    else task()
  }, delayMs)
  return () => {
    clearTimeout(timer)
    if (idleId !== null) w.cancelIdleCallback?.(idleId)
  }
}
