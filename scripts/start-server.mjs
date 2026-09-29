/**
 * Lance le serveur de dev Next.js de façon daemonisée :
 * process détaché (nouveau groupe de processus) + unref → survit à la session bash.
 */
import { spawn } from 'child_process'
import { appendFileSync } from 'fs'

import path from 'path'

const LOG = path.join(process.cwd(), 'dev.log')
const out = (msg) => {
  try {
    appendFileSync(LOG, `[daemon-launcher ${new Date().toISOString()}] ${msg}\n`)
  } catch {}
}

out('lancement demandé')
const child = spawn('bun', ['run', 'dev'], {
  cwd: process.cwd(),
  detached: true,
  stdio: ['ignore', 'ignore', 'ignore'],
  env: process.env,
})
child.unref()
out(`child pid=${child.pid} détaché`)
console.log(`Serveur lancé (pid ${child.pid}), détaché de la session.`)
