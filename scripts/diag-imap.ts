// Diagnostic IMAP direct : pourquoi imapflow timeout alors que le port 993 est ouvert ?
import { ImapFlow } from 'imapflow'
import { db } from '../src/lib/db'

async function main() {
  const row = await db.accountConnection.findFirst({ where: { provider: 'gmail', status: 'connected' } })
  if (!row) {
    console.log('Aucun gmail connecté')
    return
  }
  console.log('compte:', row.handle)
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: row.handle, pass: row.secret },
    logger: false,
  })
  const t0 = Date.now()
  const step = (m: string) => console.log(`[+${Date.now() - t0} ms] ${m}`)
  try {
    await client.connect()
    step('connecté')
    const lock = await client.getMailboxLock('INBOX')
    step(`INBOX ouvert, exists=${(client.mailbox as { exists?: number } | undefined)?.exists}`)
    const total = (client.mailbox as { exists?: number } | undefined)?.exists ?? 0
    const start = Math.max(1, total - 4 + 1)
    for await (const msg of client.fetch(`${start}:${total}`, { uid: true, envelope: true, flags: true, internalDate: true, bodyStructure: true })) {
      const from = msg.envelope?.from?.[0]
      step(`mail: « ${msg.envelope?.subject} » de ${from?.address} (${from?.name}) lu=${msg.flags?.has('\\Seen')}`)
    }
    lock.release()
    step('fetch terminé')
    await client.logout()
    step('logout OK')
  } catch (err) {
    step(`ERREUR: ${err instanceof Error ? err.message : err}`)
    try {
      client.close()
    } catch {}
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
