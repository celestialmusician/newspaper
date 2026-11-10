import { Command } from 'cmdk'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import * as React from 'react'
import { cn } from '@/lib/utils'
import { fieldBase } from './field-style'
import { Popover, PopoverContent, PopoverTrigger } from './overlay'

export interface ComboOption {
  value: string
  label: string
  hint?: string
  keywords?: string[]
}

/** Searchable dropdown (shadcn Combobox pattern). */
export function Combobox({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'No matches found.',
  disabled,
  invalid,
  className,
  id,
}: {
  value: string | null | undefined
  onChange: (v: string) => void
  options: ComboOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  invalid?: boolean
  className?: string
  id?: string
}) {
  const [open, setOpen] = React.useState(false)
  const selected = options.find((o) => o.value === value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          id={id}
          type="button"
          aria-invalid={invalid || undefined}
          aria-haspopup="listbox"
          className={cn(fieldBase, 'h-11 items-center justify-between gap-2 text-left', className)}
        >
          <span className={cn('truncate', !selected && 'text-muted-foreground/70')}>
            {selected ? selected.label : placeholder}
            {selected?.hint && <span className="ml-2 text-[12.5px] text-muted-foreground">{selected.hint}</span>}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-64 p-0" style={{ width: 'var(--radix-popover-trigger-width)' }}>
        <Command loop>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-4 text-muted-foreground" />
            <Command.Input placeholder={searchPlaceholder} className="h-11 w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/70" />
          </div>
          <Command.List className="max-h-64 overflow-y-auto p-1">
            <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">{emptyText}</Command.Empty>
            {options.map((o) => (
              <Command.Item
                key={o.value}
                value={`${o.label} ${o.hint ?? ''} ${(o.keywords ?? []).join(' ')} ${o.value}`}
                onSelect={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm data-[selected=true]:bg-accent"
              >
                <Check className={cn('size-4 text-primary', o.value === value ? 'opacity-100' : 'opacity-0')} />
                <span className="flex-1 truncate">{o.label}</span>
                {o.hint && <span className="text-[12px] text-muted-foreground">{o.hint}</span>}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
