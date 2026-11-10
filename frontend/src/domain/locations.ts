import type { DB } from './db'
import type { ID, LocationLevel, LocationNode } from './types'

export function locationIndex(db: Pick<DB, 'locations'>) {
  const byId = new Map<ID, LocationNode>()
  for (const l of db.locations) byId.set(l.id, l)
  return byId
}

/** Ancestors including the node itself, root first. */
export function locationChain(db: Pick<DB, 'locations'>, id: ID | null | undefined): LocationNode[] {
  const idx = locationIndex(db)
  const chain: LocationNode[] = []
  let cur = id ? idx.get(id) : undefined
  while (cur) {
    chain.unshift(cur)
    cur = cur.parentId ? idx.get(cur.parentId) : undefined
  }
  return chain
}

export function chainByLevel(db: Pick<DB, 'locations'>, id: ID | null | undefined) {
  const out: Partial<Record<LocationLevel, LocationNode>> = {}
  for (const n of locationChain(db, id)) out[n.level] = n
  return out
}

export function children(db: Pick<DB, 'locations'>, parentId: ID | null, level?: LocationLevel) {
  return db.locations
    .filter((l) => l.parentId === parentId && (!level || l.level === level))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function descendantIds(db: Pick<DB, 'locations'>, id: ID): Set<ID> {
  const out = new Set<ID>([id])
  let frontier = [id]
  while (frontier.length) {
    const next: ID[] = []
    for (const l of db.locations) if (l.parentId && frontier.includes(l.parentId) && !out.has(l.id)) {
      out.add(l.id)
      next.push(l.id)
    }
    frontier = next
  }
  return out
}

export function areaLabel(db: Pick<DB, 'locations'>, areaId: ID | null | undefined) {
  const c = chainByLevel(db, areaId)
  return [c.area?.name, c.city?.name].filter(Boolean).join(', ')
}

export function fullAddressLine(db: Pick<DB, 'locations'>, areaId: ID) {
  const c = chainByLevel(db, areaId)
  return [c.area?.name, c.locality?.name !== c.area?.name ? c.locality?.name : null, c.city?.name, c.district?.name !== c.city?.name ? c.district?.name : null, c.state?.name, c.area?.pincode]
    .filter(Boolean)
    .join(', ')
}
