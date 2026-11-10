# NewsRound — frontend

See the [project README](../README.md). Key folders:

- `src/domain` — business engines (schedule, pricing, billing, stock, access) — pure TypeScript
- `src/services` — mock API server (`api.ts`), store, offline queue, REST client (`http.ts`)
- `src/components/ui` — design system (shadcn-style on Radix)
- `src/pages` — role-aware screens
- `src/data/seed.ts` — interconnected Kerala demo data (exported to the backend via `scripts/export-seed.mjs`)
