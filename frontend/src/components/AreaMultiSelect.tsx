import { Check, ChevronsUpDown } from 'lucide-react'
import { Command } from 'cmdk'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlay'
import { areaLabel } from '@/domain/locations'
import type { ID } from '@/domain/types'
import { useData } from '@/hooks/app'
import { cn } from '@/lib/utils'

/** Searchable multi-select of areas from the central location master. */
export function AreaMultiSelect({ value, onChange, limitTo, invalid }: { value: ID[]; onChange: (v: ID[]) => void; limitTo?: ID[]; invalid?: boolean }) {
  const db = useData()
  const areas = db.locations.filter((l) => l.level === 'area' && (!limitTo || limitTo.includes(l.id))).sort((a, b) => areaLabel(db, a.id).localeCompare(areaLabel(db, b.id)))
  const toggle = (id: ID) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-invalid={invalid || undefined} className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-input bg-card px-3 py-1.5 text-left text-[14px] aria-[invalid=true]:border-destructive">
          <span className="flex flex-wrap gap-1">
            {value.length ? (
              value.map((id) => (
                <span key={id} className="rounded-md bg-primary/8 px-2 py-0.5 text-[12.5px] font-semibold text-primary">
                  {db.locations.find((l) => l.id === id)?.name}
                </span>
              ))
            ) : (
              <span className="text-muted-foreground/70">Select areas</span>
            )}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0" style={{ width: 'var(--radix-popover-trigger-width)' }}>
        <Command>
          <Command.Input placeholder="Search areas…" className="h-11 w-full border-b border-border bg-transparent px-3 text-[14px] outline-none" />
          <Command.List className="max-h-64 overflow-y-auto p-1">
            <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">No areas.</Command.Empty>
            {areas.map((a) => (
              <Command.Item key={a.id} value={`${areaLabel(db, a.id)} ${a.pincode}`} onSelect={() => toggle(a.id)} className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm data-[selected=true]:bg-accent">
                <span className={cn('grid size-4 place-items-center rounded border', value.includes(a.id) ? 'border-primary bg-primary text-primary-foreground' : 'border-input')}>{value.includes(a.id) && <Check className="size-3" />}</span>
                <span className="flex-1">{areaLabel(db, a.id)}</span>
                <span className="text-[12px] text-muted-foreground">{a.pincode}</span>
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
