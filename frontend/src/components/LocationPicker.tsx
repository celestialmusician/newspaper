import * as React from 'react'
import { Combobox } from '@/components/ui/combobox'
import { Field, Input } from '@/components/ui/form'
import { chainByLevel, children } from '@/domain/locations'
import { LOCATION_LEVELS, type ID, type LocationLevel } from '@/domain/types'
import { useData } from '@/hooks/app'

const LABEL: Record<LocationLevel, string> = { country: 'Country', state: 'State', district: 'District', city: 'City / Town', locality: 'Locality', area: 'Area' }

/**
 * Cascading Country → State → District → City → Locality → Area picker.
 * Reads the central location master, so any area added by admin/agent appears everywhere instantly.
 * Pincode search jumps straight to matching areas.
 */
export function LocationPicker({ value, onChange, error, allowedAreaIds, compact }: { value: ID | null; onChange: (areaId: ID | null) => void; error?: string; allowedAreaIds?: ID[]; compact?: boolean }) {
  const db = useData()
  const chain = chainByLevel(db, value)
  const [sel, setSel] = React.useState<Partial<Record<LocationLevel, ID>>>(() => Object.fromEntries(Object.entries(chain).map(([k, v]) => [k, v!.id])))
  const [pincode, setPincode] = React.useState(chain.area?.pincode ?? '')

  React.useEffect(() => {
    if (!value) return
    const c = chainByLevel(db, value)
    setSel(Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v!.id])))
    setPincode(c.area?.pincode ?? '')
  }, [value, db])

  const allowed = allowedAreaIds ? new Set(allowedAreaIds) : null
  const pinMatches = /^\d{6}$/.test(pincode) ? db.locations.filter((l) => l.level === 'area' && l.pincode === pincode && (!allowed || allowed.has(l.id))) : []

  const choose = (level: LocationLevel, id: ID) => {
    const idx = LOCATION_LEVELS.indexOf(level)
    const next: Partial<Record<LocationLevel, ID>> = {}
    for (const l of LOCATION_LEVELS.slice(0, idx)) next[l] = sel[l]
    next[level] = id
    // Auto-advance through single-option levels.
    let parent = id
    for (const l of LOCATION_LEVELS.slice(idx + 1)) {
      const opts = children(db, parent, l)
      if (opts.length !== 1) break
      next[l] = opts[0]!.id
      parent = opts[0]!.id
    }
    setSel(next)
    onChange(next.area ?? null)
    if (next.area) setPincode(db.locations.find((l) => l.id === next.area)?.pincode ?? '')
  }

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      <Field label="Pincode" hint={pinMatches.length ? `${pinMatches.length} area(s) match this pincode — pick one below.` : compact ? undefined : 'Optional — type a 6-digit pincode to find your area faster.'}>
        <div className="flex flex-wrap items-center gap-2">
          <Input value={pincode} onChange={(e) => setPincode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="695011" className="w-36" />
          {pinMatches.map((a) => (
            <button key={a.id} type="button" onClick={() => selectChainFor(a.id)} className="rounded-full border border-border bg-card px-3 py-1.5 text-[13px] font-semibold hover:border-primary">
              {a.name}
            </button>
          ))}
        </div>
      </Field>
      <div className={compact ? 'grid grid-cols-2 gap-x-3 gap-y-3' : 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'}>
        {LOCATION_LEVELS.map((level, i) => {
          const parentId = i === 0 ? null : sel[LOCATION_LEVELS[i - 1]!]
          const opts = i === 0 || parentId ? children(db, parentId ?? null, level).filter((o) => level !== 'area' || !allowed || allowed.has(o.id)) : []
          return (
            <Field key={level} label={LABEL[level]} required error={level === 'area' ? error : undefined}>
              <Combobox
                value={sel[level]}
                onChange={(id) => choose(level, id)}
                disabled={i > 0 && !parentId}
                invalid={level === 'area' && !!error}
                placeholder={i > 0 && !parentId ? `Select ${LABEL[LOCATION_LEVELS[i - 1]!].toLowerCase()} first` : `Select ${LABEL[level].toLowerCase()}`}
                options={opts.map((o) => ({ value: o.id, label: o.name, hint: o.pincode }))}
                emptyText="No options. Ask your agent to add it."
              />
            </Field>
          )
        })}
      </div>
    </div>
  )

  function selectChainFor(areaId: ID) {
    const c = chainByLevel(db, areaId)
    const next = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v!.id]))
    setSel(next)
    onChange(areaId)
  }
}
