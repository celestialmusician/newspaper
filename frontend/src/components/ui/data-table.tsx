import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, FileText, Inbox, LayoutGrid, Plus, Rows3, Search, type LucideIcon } from 'lucide-react'
import * as React from 'react'
import { cn, downloadText, initials, toCSV } from '@/lib/utils'
import { Button } from './button'
import { useActor, useData } from '@/hooks/app'
import { Input, NativeSelect } from './form'
import { Card, EmptyState, Skeleton } from './misc'
import { useWorkspace } from './workspace-ctx'

export interface Column<T> {
  key: string
  header: React.ReactNode
  cell: (row: T) => React.ReactNode
  sort?: (row: T) => string | number
  className?: string
  align?: 'left' | 'right' | 'center'
  /** Hidden in the mobile card view. */
  hideOnMobile?: boolean
  /** Header label used in mobile cards / CSV. */
  label?: string
  csv?: (row: T) => string | number
}

interface DataTableProps<T> {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  search?: (row: T) => string
  searchPlaceholder?: string
  toolbar?: React.ReactNode
  onRowClick?: (row: T) => void
  pageSize?: number
  loading?: boolean
  empty?: { icon?: LucideIcon; title: string; description?: string; action?: React.ReactNode }
  initialSort?: { key: string; dir: 'asc' | 'desc' }
  exportName?: string
  /** Adds the legacy "All / Active / Deactive" filter above the list. */
  statusOf?: (row: T) => 'active' | 'inactive'
  /** Title column for mobile cards (defaults to the first column). */
  mobileTitle?: (row: T) => React.ReactNode
  mobileAside?: (row: T) => React.ReactNode
  /** Name for the initials badge on record cards. */
  cardAvatar?: (row: T) => string
  /** Phone cards: actions beside the title (default) or as a full row under the details (many actions). */
  mobileActions?: 'top' | 'bottom'
  className?: string
  dense?: boolean
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  search,
  searchPlaceholder = 'Search…',
  toolbar,
  onRowClick,
  pageSize: initialPageSize = 10,
  loading,
  empty,
  initialSort,
  exportName,
  statusOf,
  mobileTitle,
  mobileAside,
  cardAvatar,
  mobileActions = 'top',
  className,
  dense,
}: DataTableProps<T>) {
  // Inside a records workspace: cards by default (table on request), plus the Add button and tile.
  const ws = useWorkspace()
  const viewKey = `nap.view.${exportName ?? 'list'}`
  const [view, setViewState] = React.useState<'grid' | 'table'>(() => {
    try {
      const v = localStorage.getItem(viewKey)
      if (v === 'grid' || v === 'table') return v
    } catch {
      /* storage blocked: use the default */
    }
    return 'grid'
  })
  const setView = (v: 'grid' | 'table') => {
    setViewState(v)
    try {
      localStorage.setItem(viewKey, v)
    } catch {
      /* not remembered, still switches */
    }
  }
  const grid = !!ws && view === 'grid'
  const addLabel = ws ? `Add ${ws.noun}` : ''
  const add = () => ws?.setOpen(true)
  const db = useData()
  const actor = useActor()
  const [q, setQ] = React.useState('')
  const [shown, setShown] = React.useState<'all' | 'active' | 'inactive'>('all')
  const [sort, setSort] = React.useState(initialSort ?? null)
  const [page, setPage] = React.useState(0)
  const [pageSize, setPageSize] = React.useState(initialPageSize)

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase()
    let out = needle && search ? rows.filter((r) => search(r).toLowerCase().includes(needle)) : rows
    if (statusOf && shown !== 'all') out = out.filter((r) => statusOf(r) === shown)
    if (sort) {
      const col = columns.find((c) => c.key === sort.key)
      if (col?.sort) {
        const get = col.sort
        out = [...out].sort((a, b) => {
          const va = get(a)
          const vb = get(b)
          const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'en-IN', { numeric: true })
          return sort.dir === 'asc' ? cmp : -cmp
        })
      }
    }
    return out
  }, [rows, q, sort, columns, search, statusOf, shown])

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = Math.min(page, pages - 1)
  const visible = filtered.slice(current * pageSize, current * pageSize + pageSize)

  const toggleSort = (key: string) => setSort((s) => (s?.key === key ? (s.dir === 'asc' ? { key, dir: 'desc' } : null) : { key, dir: 'asc' }))

  const exportCols = columns.filter((c) => c.csv || c.sort)
  const headOf = (c: Column<T>) => c.label ?? (typeof c.header === 'string' ? c.header : c.key)
  /** "Excel": a UTF-8 CSV (with a byte-order mark so Excel reads ₹ and Malayalam correctly). */
  const exportExcel = () => {
    const data = filtered.map((r) => Object.fromEntries(exportCols.map((c) => [headOf(c), c.csv ? c.csv(r) : c.sort!(r)])))
    downloadText(`${exportName}.csv`, String.fromCharCode(0xfeff) + toCSV(data))
  }
  const exportPdf = async () => {
    const { downloadTablePDF } = await import('@/lib/pdf')
    await downloadTablePDF(
      (exportName ?? 'list').replace(/-/g, ' '),
      db.agents.find((a) => a.id === actor.userId)?.agencyName ?? db.settings.agencyName,
      ['Sl No', ...exportCols.filter((c) => c.key !== 'n').map(headOf)],
      filtered.map((r, i) => [i + 1, ...exportCols.filter((c) => c.key !== 'n').map((c) => c.csv ? c.csv(r) : c.sort!(r))]),
      exportName ?? 'list',
    )
  }

  const titleCol = columns[0]!
  // Edit / delete sit right after the serial number, so they are found without scrolling a wide table.
  const actCol = columns[0]?.key === 'n' ? columns.find((c) => c.key === 'act') : undefined
  const tableCols = actCol ? [columns[0]!, { ...actCol, header: actCol.header || 'Action', className: cn('w-px whitespace-nowrap', actCol.className) }, ...columns.slice(1).filter((c) => c !== actCol)] : columns
  const cardCols = columns.slice(1).filter((c) => !c.hideOnMobile && c !== actCol)

  /** One record as a card: phones always, wider screens in the card view. */
  const card = (r: T, tile: boolean) => (
    <div
      role={onRowClick ? 'button' : undefined}
      tabIndex={onRowClick ? 0 : undefined}
      onClick={onRowClick ? () => onRowClick(r) : undefined}
      className={cn(tile ? 'rec-card' : 'block w-full px-4 py-3.5 text-left transition-colors duration-200', onRowClick && 'cursor-pointer', onRowClick && !tile && 'active:bg-accent hover:bg-accent/60')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {tile && cardAvatar && <span className="rec-avatar">{initials(cardAvatar(r))}</span>}
          <div className="min-w-0 flex-1">{mobileTitle ? mobileTitle(r) : titleCol.cell(r)}</div>
        </div>
        {mobileAside && <div className="shrink-0">{mobileAside(r)}</div>}
        {actCol && (tile || mobileActions === 'top') && <div className="-my-1 shrink-0">{actCol.cell(r)}</div>}
      </div>
      <dl className={cn('grid grid-cols-2 gap-x-4 gap-y-1.5', tile ? 'mt-3 border-t border-border/60 pt-3' : 'mt-2')}>
        {cardCols.map((c) => (
          <div key={c.key} className="min-w-0">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{c.label ?? c.header}</dt>
            <dd className="truncate text-[13.5px]">{c.cell(r)}</dd>
          </div>
        ))}
      </dl>
      {actCol && !tile && mobileActions === 'bottom' && <div className="card-actions mt-3 border-t border-border/60 pt-3">{actCol.cell(r)}</div>}
    </div>
  )

  return (
    <Card className={cn('overflow-hidden', className)}>
      {(search || toolbar || exportName || ws) && (
        <div className="flex flex-col gap-3 border-b border-border/70 p-3 sm:flex-row sm:items-center sm:p-4">
          {search && (
            <div className="relative sm:max-w-xs sm:flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  setPage(0)
                }}
                placeholder={searchPlaceholder}
                className="h-10 pl-9"
                aria-label="Search"
              />
            </div>
          )}
          <div className="flex flex-1 flex-wrap items-center gap-2 sm:justify-end">
            {statusOf && (
              <NativeSelect
                value={shown}
                onChange={(e) => {
                  setShown(e.target.value as typeof shown)
                  setPage(0)
                }}
                className="h-10 w-36"
                aria-label="Show entries"
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="inactive">Deactive</option>
              </NativeSelect>
            )}
            {toolbar}
            {ws && (
              <div className="view-switch" role="radiogroup" aria-label="View">
                <button type="button" role="radio" aria-checked={view === 'grid'} aria-label="Cards" onClick={() => setView('grid')}>
                  <LayoutGrid />
                </button>
                <button type="button" role="radio" aria-checked={view === 'table'} aria-label="Table" onClick={() => setView('table')}>
                  <Rows3 />
                </button>
              </div>
            )}
            {exportName && (
              <>
                <Button variant="outline" size="sm" onClick={() => void exportPdf()} disabled={!filtered.length}>
                  <FileText /> PDF
                </Button>
                <Button variant="outline" size="sm" onClick={exportExcel} disabled={!filtered.length}>
                  <Download /> Excel
                </Button>
              </>
            )}
            {ws && (
              <Button size="sm" onClick={add} className="h-9">
                <Plus /> {addLabel}
              </Button>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : !filtered.length ? (
        <EmptyState icon={empty?.icon ?? Inbox} title={q ? 'No results' : empty?.title ?? 'Nothing here yet'} description={q ? `Nothing matches "${q}".` : empty?.description} action={q ? undefined : empty?.action ?? (ws ? <Button onClick={add}><Plus /> {addLabel}</Button> : undefined)} />
      ) : (
        <>
          {/* Wider screens: record cards in a grid, with an "Add" tile at the end */}
          {grid && (
            <div className="rec-grid hidden md:grid">
              {visible.map((r) => (
                <div key={rowKey(r)} className="row-drop">
                  {card(r, true)}
                </div>
              ))}
              <button type="button" className="rec-add" onClick={add}>
                <span className="rec-add-icon">
                  <Plus />
                </span>
                {addLabel}
              </button>
            </div>
          )}
          {/* Desktop / tablet table */}
          <div className={cn('hidden overflow-x-auto', !grid && 'md:block')}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/70 bg-muted/50">
                  {tableCols.map((c) => (
                    <th key={c.key} className={cn('whitespace-nowrap px-4 py-2.5 text-left text-[11.5px] font-bold uppercase tracking-wider text-muted-foreground', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.className)}>
                      {c.sort ? (
                        <button className={cn('inline-flex items-center gap-1 hover:text-foreground', c.align === 'right' && 'flex-row-reverse')} onClick={() => toggleSort(c.key)}>
                          {c.header}
                          {sort?.key === c.key ? sort.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
                        </button>
                      ) : (
                        c.header
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr
                    key={rowKey(r)}
                    onClick={onRowClick ? () => onRowClick(r) : undefined}
                    className={cn('row-drop border-b border-border/50 transition-[background-color,box-shadow] duration-200 last:border-0 hover:bg-accent/40', onRowClick && 'cursor-pointer hover:bg-accent/70 hover:shadow-[inset_3px_0_0_var(--brand)]')}
                  >
                    {tableCols.map((c) => (
                      <td key={c.key} className={cn('px-4 align-middle', dense ? 'py-2' : 'py-3', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.className)}>
                        {c.cell(r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="divide-y divide-border/60 md:hidden">
            {visible.map((r) => (
              <li key={rowKey(r)} className="row-drop">
                {card(r, false)}
              </li>
            ))}
          </ul>

          <div className="flex flex-col items-center justify-between gap-3 border-t border-border/70 px-4 py-3 text-[13px] text-muted-foreground sm:flex-row">
            <div className="flex items-center gap-2">
              <span>
                {current * pageSize + 1}–{Math.min(filtered.length, (current + 1) * pageSize)} of {filtered.length}
              </span>
              <NativeSelect
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value))
                  setPage(0)
                }}
                className="h-8 w-[108px] text-[13px]"
                aria-label="Rows per page"
              >
                {[10, 25, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n} / page
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon-sm" disabled={current === 0} onClick={() => setPage(current - 1)} aria-label="Previous page">
                <ChevronLeft />
              </Button>
              <span className="px-2 font-semibold text-foreground">
                {current + 1} / {pages}
              </span>
              <Button variant="outline" size="icon-sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} aria-label="Next page">
                <ChevronRight />
              </Button>
            </div>
          </div>
        </>
      )}
    </Card>
  )
}
