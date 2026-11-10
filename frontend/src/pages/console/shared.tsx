import { Check, ChevronsUpDown, Lock, type LucideIcon, Pencil, SlidersHorizontal, Trash2 } from 'lucide-react'
import { Command } from 'cmdk'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { FormActions } from '@/components/ui/form-guide'
import { DrawerBody, FormDrawer } from '@/components/ui/workspace'
import { useWorkspace, WorkspaceCtx } from '@/components/ui/workspace-ctx'
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/misc'
import { Popover, PopoverContent, PopoverTrigger, Tooltip } from '@/components/ui/overlay'
import type { ID } from '@/domain/types'
import { useData } from '@/hooks/app'
import { cn } from '@/lib/utils'

/**
 * Records page: the list fills the page (cards or table) and the form opens in a drawer from
 * the right, on "Add" or on a row's edit icon. `inline` keeps a short settings form on the page,
 * as a strip under its summary, for forms that are not about adding records (Bill Serial).
 */
export function FormTable({ form, children, noun = 'record', inline }: { form: React.ReactNode; children: React.ReactNode; noun?: string; inline?: boolean }) {
  const [open, setOpen] = React.useState(false)
  if (inline)
    return (
      <div className="grid gap-5">
        <div className="min-w-0">{children}</div>
        <div className="form-strip">{form}</div>
      </div>
    )
  return (
    <WorkspaceCtx.Provider value={{ open, setOpen, noun }}>
      <div className="min-w-0">{children}</div>
      {form}
    </WorkspaceCtx.Provider>
  )
}

const plain = (n: React.ReactNode) => (typeof n === 'string' ? n.replace(/\s+(form|master)$/i, '') : n)

export function FormCard({
  title,
  description,
  editing,
  onCancel,
  onSubmit,
  pending,
  submitLabel,
  icon,
  children,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  editing?: boolean
  onCancel?: () => void
  /** Return `true` when the record was saved: the drawer then closes. */
  onSubmit: () => unknown
  pending?: boolean
  submitLabel?: string
  icon?: LucideIcon
  children: React.ReactNode
}) {
  const ws = useWorkspace()
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const ok = await onSubmit()
    if (ok === true) ws?.setOpen(false)
  }
  const buttons = (
    <>
      {(editing || ws) && (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (editing) onCancel?.()
            ws?.setOpen(false)
          }}
        >
          Cancel
        </Button>
      )}
      <Button type="submit" loading={pending}>
        {submitLabel ?? (editing ? 'Save changes' : 'Save')}
      </Button>
    </>
  )

  if (ws) {
    const close = () => {
      if (editing) onCancel?.()
      ws.setOpen(false)
    }
    // "Editing Akhil S" becomes the drawer title "Edit Akhil S"; any other description is shown under it.
    const isName = typeof description === 'string' && description.startsWith('Editing ')
    const name = isName ? (description as string).slice('Editing '.length) : ''
    return (
      <FormDrawer
        open={ws.open || !!editing}
        onClose={close}
        kicker={plain(title)}
        title={editing ? (name ? `Edit ${name}` : `Edit ${ws.noun}`) : `New ${ws.noun}`}
        description={isName ? undefined : description}
      >
        <form noValidate onSubmit={(e) => void submit(e)} className="flex min-h-0 flex-1 flex-col">
          <DrawerBody className="grid content-start gap-4">{children}</DrawerBody>
          <FormActions className="in-drawer">{buttons}</FormActions>
        </form>
      </FormDrawer>
    )
  }

  return (
    <Card>
      <CardHeader icon={icon} title={plain(title)} description={description} action={editing ? <Badge tone="warning">Editing</Badge> : undefined} />
      <form noValidate onSubmit={(e) => void submit(e)}>
        <CardBody className="grid gap-4">{children}</CardBody>
        <FormActions>{buttons}</FormActions>
      </form>
    </Card>
  )
}

/**
 * Report / search page: the filters sit in a rail on the left that stays in view while the
 * results scroll on the right. On phones the rail folds into a "Filters" panel above the results.
 */
export function QueryDesk({ filters, summary, children }: { filters: React.ReactNode; summary?: React.ReactNode; children: React.ReactNode }) {
  const rail = React.useRef<HTMLDetailsElement>(null)
  const results = React.useRef<HTMLElement>(null)
  // Below the side-rail width the filters sit above the results: after "Show" they fold away and
  // the results come into view (the panel opens again with one tap).
  const onSubmit = () => {
    if (window.matchMedia('(min-width: 1280px)').matches || !rail.current) return
    requestAnimationFrame(() => {
      rail.current!.open = false
      results.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    })
  }
  return (
    <div className="query-desk">
      <details ref={rail} className="query-rail" open onSubmit={onSubmit}>
        <summary className="query-rail-head">
          <SlidersHorizontal className="size-4" /> Filters
        </summary>
        <div className="query-rail-body">{filters}</div>
      </details>
      <section ref={results} className="min-w-0 scroll-mt-24">
        {summary && <h2 className="query-summary">{summary}</h2>}
        {children}
      </section>
    </div>
  )
}

/** Edit + delete icons. A padlock replaces delete when the record is in use (it can only be deactivated). */
export function RowActions({ onEdit, onDelete, lockedReason }: { onEdit?: () => void; onDelete?: () => void; lockedReason?: string }) {
  return (
    <div className="flex items-center gap-1">
      {onEdit && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Edit"
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
        >
          <Pencil />
        </Button>
      )}
      {lockedReason ? (
        <Tooltip content={lockedReason}>
          <span className="grid size-8 place-items-center rounded-lg text-muted-foreground" aria-label={lockedReason}>
            <Lock className="size-4" />
          </span>
        </Tooltip>
      ) : (
        onDelete && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Delete"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          >
            <Trash2 />
          </Button>
        )
      )}
    </div>
  )
}

/** Searchable multi-select of agency accounts with a "Select All" row. */
export function AccountMultiSelect({ value, onChange, invalid }: { value: ID[]; onChange: (v: ID[]) => void; invalid?: boolean }) {
  const db = useData()
  const all = db.agents.map((a) => a.id)
  const allOn = all.length > 0 && all.every((id) => value.includes(id))
  const toggle = (id: ID) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-invalid={invalid || undefined} className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-input bg-card px-3 py-1.5 text-left text-[14px] aria-[invalid=true]:border-destructive">
          <span className="flex flex-wrap gap-1">
            {allOn ? (
              <span className="rounded-md bg-primary/8 px-2 py-0.5 text-[12.5px] font-semibold text-primary">All accounts ({all.length})</span>
            ) : value.length ? (
              value.map((id) => (
                <span key={id} className="rounded-md bg-primary/8 px-2 py-0.5 text-[12.5px] font-semibold text-primary">
                  {db.agents.find((a) => a.id === id)?.agencyName}
                </span>
              ))
            ) : (
              <span className="text-muted-foreground/70">Select accounts</span>
            )}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0" style={{ width: 'var(--radix-popover-trigger-width)' }}>
        <Command>
          <Command.Input placeholder="Search accounts…" className="h-11 w-full border-b border-border bg-transparent px-3 text-[14px] outline-none" />
          <Command.List className="max-h-64 overflow-y-auto p-1">
            <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">No accounts.</Command.Empty>
            <Command.Item value="select all accounts" onSelect={() => onChange(allOn ? [] : all)} className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-semibold data-[selected=true]:bg-accent">
              <Tick on={allOn} />
              Select all
            </Command.Item>
            {db.agents.map((a) => (
              <Command.Item key={a.id} value={`${a.agencyName} ${a.name}`} onSelect={() => toggle(a.id)} className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm data-[selected=true]:bg-accent">
                <Tick on={value.includes(a.id)} />
                <span className="flex-1">{a.agencyName}</span>
                <span className="text-[12px] text-muted-foreground">{a.code}</span>
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function Tick({ on }: { on: boolean }) {
  return <span className={cn('grid size-4 place-items-center rounded border', on ? 'border-primary bg-primary text-primary-foreground' : 'border-input')}>{on && <Check className="size-3" />}</span>
}
