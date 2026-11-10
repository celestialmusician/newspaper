// Exports the frontend demo seed to JSON so the Django `seed_demo` command loads the exact same dataset.
// Usage: node scripts/export-seed.mjs ../backend/fixtures/demo_seed.json
import { createServer } from 'vite'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const out = resolve(process.argv[2] ?? '../backend/fixtures/demo_seed.json')
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
try {
  const { buildSeed } = await server.ssrLoadModule('/src/data/seed.ts')
  const db = buildSeed()
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(db, null, 1))
  console.log(`Wrote ${out}: ${db.customers.length} customers, ${db.subscriptions.length} subscriptions, ${Object.keys(db.deliveries).length} deliveries, ${db.invoices.length} invoices`)
} finally {
  await server.close()
}
