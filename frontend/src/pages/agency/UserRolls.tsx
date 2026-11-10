import { ShieldCheck, Users } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { navFor } from '@/app/nav'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Field, Input, NativeSelect, Switch, Textarea } from '@/components/ui/form'
import { PageHeader, StatusBadge } from '@/components/ui/misc'
import { useConfirm } from '@/components/ui/overlay'
import { OWNER_ONLY } from '@/domain/staff'
import type { RollAction, StaffUser, UserRoll } from '@/domain/types'
import { useActor, useData, useRun, useWarmup } from '@/hooks/app'
import { staffUsers as userApi, userRolls as rollApi } from '@/services/api'
import { FormCard, FormTable, RowActions } from '../console/shared'

const ACTIONS: { key: RollAction; label: string }[] = [
  { key: 'view', label: 'View' },
  { key: 'add', label: 'Save' },
  { key: 'edit', label: 'Update' },
  { key: 'delete', label: 'Delete' },
]

/** The agent menu as a permissions matrix: groups with their pages. */
function useMenuRows() {
  return React.useMemo(
    () =>
      // Pages only the owner can open (User Roll, User, Change Password) are not offered to a roll.
      navFor('agent', (p) => !OWNER_ONLY.includes(p))[0]!.items.flatMap((it) =>
        it.children
          ? [{ to: '', label: it.label, head: true }, ...it.children.flatMap((c, i) => [...(c.group && c.group !== it.children![i - 1]?.group ? [{ to: '', label: c.group, head: true }] : []), { to: c.to, label: c.label, head: false }])]
          : [{ to: it.to, label: it.label, head: false }],
      ),
    [],
  )
}

/** User Roll: what each kind of staff user may open and do. */
export function UserRollPage() {
  const db = useData()
  const ready = useWarmup()
  const actor = useActor()
  const confirm = useConfirm()
  const { run, pending } = useRun()
  const menu = useMenuRows()
  const [editing, setEditing] = React.useState<UserRoll | null>(null)
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [active, setActive] = React.useState(true)
  const [perms, setPerms] = React.useState<Record<string, RollAction[]>>({})
  const [error, setError] = React.useState('')

  const rows = db.userRolls.filter((r) => r.agentId === actor.userId).map((r, n) => ({ r, n: n + 1, used: db.staffUsers.filter((u) => u.rollId === r.id).length }))
  type Row = (typeof rows)[number]

  const clear = () => {
    setEditing(null)
    setName('')
    setDescription('')
    setActive(true)
    setPerms({})
    setError('')
  }
  const startEdit = (r: UserRoll) => {
    setEditing(r)
    setName(r.name)
    setDescription(r.description)
    setActive(r.status === 'active')
    setPerms(r.perms)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const toggle = (path: string, a: RollAction) =>
    setPerms((p) => {
      const cur = p[path] ?? []
      const next = cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]
      // Add, edit and delete are only useful with view.
      const fixed = a !== 'view' && next.length && !next.includes('view') ? [...next, 'view' as RollAction] : a === 'view' && !next.includes('view') ? [] : next
      return { ...p, [path]: fixed }
    })
  const setPage = (path: string, on: boolean) => setPerms((p) => ({ ...p, [path]: on ? ACTIONS.map((x) => x.key) : [] }))

  const save = async () => {
    setError('')
    if (!name.trim()) return setError('Enter the user type.')
    if (!Object.values(perms).some((v) => v.length)) return setError('Tick at least one page for this roll.')
    const ok = await run(() => rollApi.save({ id: editing?.id, name, description, status: active ? 'active' : 'inactive', perms }), editing ? 'User roll updated' : 'User roll saved')
    if (ok) clear()
    return !!ok
  }
  const remove = async (r: UserRoll) => {
    if (await confirm({ title: `Delete ${r.name}?`, description: 'No user has this roll, so it can be removed.', tone: 'destructive', confirmLabel: 'Delete' })) await run(() => rollApi.remove(r.id), 'User roll deleted')
  }

  const cols: Column<Row>[] = [
    { key: 'n', header: 'Sl No', sort: (r) => r.n, cell: (r) => r.n, className: 'w-14' },
    { key: 'name', header: 'User Roll', sort: (r) => r.r.name, cell: (r) => <span className="font-semibold">{r.r.name}</span>, csv: (r) => r.r.name, hideOnMobile: true },
    { key: 'st', header: 'Status', sort: (r) => r.r.status, cell: (r) => <StatusBadge status={r.r.status} />, csv: (r) => r.r.status },
    { key: 'act', header: '', cell: (r) => <RowActions onEdit={() => startEdit(r.r)} onDelete={() => void remove(r.r)} lockedReason={r.used ? `${r.used} user${r.used > 1 ? 's' : ''} have this roll` : undefined} /> },
  ]

  return (
    <>
      <PageHeader kicker="Settings" title="Users Roll" description="Manage User Roll Details — what each type of staff user may open and do." />
      <FormTable
        noun="user roll"
        form={
          <FormCard title="Manage User Roll Form" description={editing ? `Editing ${editing.name}` : undefined} editing={!!editing} onCancel={clear} onSubmit={save} pending={pending}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="User Type" required>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Description">
                <Textarea rows={1} value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-11" />
              </Field>
            </div>
            <Switch checked={active} onCheckedChange={setActive} label="Active / Deactive" />
            <div>
              <div className="mb-2 text-[13px] font-semibold">Submenu</div>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/70 bg-muted/50 text-left text-[11.5px] font-bold uppercase tracking-wider text-muted-foreground">
                      <th className="px-3 py-2">Menu</th>
                      <th className="px-3 py-2 text-center">All</th>
                      {ACTIONS.map((a) => (
                        <th key={a.key} className="px-3 py-2 text-center">
                          {a.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {menu.map((m) =>
                      m.head ? (
                        <tr key={m.label} className="bg-accent/40">
                          <td colSpan={6} className="px-3 py-1.5 text-[12.5px] font-bold uppercase tracking-wide text-primary">
                            {m.label}
                          </td>
                        </tr>
                      ) : (
                        <tr key={m.to} className="border-b border-border/50 last:border-0">
                          <td className="px-3 py-2">{m.label}</td>
                          <td className="px-3 py-2 text-center">
                            <input type="checkbox" className="size-[18px] accent-[var(--brand)]" checked={(perms[m.to]?.length ?? 0) === ACTIONS.length} onChange={(e) => setPage(m.to, e.target.checked)} aria-label={`${m.label} all`} />
                          </td>
                          {ACTIONS.map((a) => (
                            <td key={a.key} className="px-3 py-2 text-center">
                              <input type="checkbox" className="size-[18px] accent-[var(--brand)]" checked={perms[m.to]?.includes(a.key) ?? false} onChange={() => toggle(m.to, a.key)} aria-label={`${m.label} ${a.label}`} />
                            </td>
                          ))}
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            {error && <p className="text-[13px] font-medium text-destructive">{error}</p>}
          </FormCard>
        }
      >
        <DataTable loading={!ready} rows={rows} columns={cols} rowKey={(r) => r.r.id} mobileTitle={(r) => <span className="font-semibold">{r.n}. {r.r.name}</span>} exportName="user-rolls" empty={{ icon: ShieldCheck, title: 'No user rolls yet' }} />
      </FormTable>
    </>
  )
}

/** Create User: staff users of the agency with the roll that decides what they may do. */
export function UsersPage() {
  const db = useData()
  const ready = useWarmup()
  const actor = useActor()
  const confirm = useConfirm()
  const { run, pending } = useRun()
  const [editing, setEditing] = React.useState<StaffUser | null>(null)
  const [f, setF] = React.useState({ rollId: '', name: '', extension: '', password: '', description: '', active: true })
  const rolls = db.userRolls.filter((r) => r.agentId === actor.userId && r.status === 'active')
  const rows = db.staffUsers.filter((u) => u.agentId === actor.userId).map((u, n) => ({ u, n: n + 1, roll: db.userRolls.find((r) => r.id === u.rollId)?.name ?? '—' }))
  type Row = (typeof rows)[number]
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))
  const clear = () => {
    setEditing(null)
    setF({ rollId: '', name: '', extension: '', password: '', description: '', active: true })
  }
  const cols: Column<Row>[] = [
    { key: 'n', header: 'Sl No', sort: (r) => r.n, cell: (r) => r.n, className: 'w-14' },
    { key: 'roll', header: 'User Type', sort: (r) => r.roll, cell: (r) => r.roll, csv: (r) => r.roll },
    { key: 'name', header: 'Name', sort: (r) => r.u.name, cell: (r) => <span><span className="block font-semibold">{r.u.name}</span>{r.u.extension && <span className="text-[12px] text-muted-foreground">Ext. {r.u.extension}</span>}</span>, csv: (r) => r.u.name, hideOnMobile: true },
    { key: 'ad', header: 'A/D', sort: (r) => r.u.status, cell: (r) => <StatusBadge status={r.u.status} />, csv: (r) => r.u.status },
    { key: 'act', header: '', cell: (r) => <RowActions onEdit={() => { setEditing(r.u); setF({ rollId: r.u.rollId, name: r.u.name, extension: r.u.extension ?? '', password: '', description: r.u.description, active: r.u.status === 'active' }) }} onDelete={() => void confirm({ title: `Delete ${r.u.name}?`, description: 'The user is removed.', tone: 'destructive', confirmLabel: 'Delete' }).then((ok) => ok && run(() => userApi.remove(r.u.id), 'User deleted'))} /> },
  ]
  return (
    <>
      <PageHeader kicker="Settings" title="Create User" description="User Details — staff who work in your agency's account." />
      <FormTable
        noun="user"
        form={
          <FormCard
            title="Create User Form"
            editing={!!editing}
            onCancel={clear}
            pending={pending}
            onSubmit={async () => {
              if (!f.rollId) return void toast.error('Select the user roll.')
              const ok = await run(() => userApi.save({ id: editing?.id, rollId: f.rollId, name: f.name, extension: f.extension.trim() || undefined, password: f.password || undefined, description: f.description, status: f.active ? 'active' : 'inactive' }), editing ? 'User updated' : 'User saved')
              if (ok) clear()
              return !!ok
            }}
          >
            <Field label="User Roll" required>
              <NativeSelect value={f.rollId} onChange={(e) => set('rollId', e.target.value)}>
                <option value="">Select User Roll</option>
                {rolls.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Extension">
              <Input value={f.extension} inputMode="numeric" onChange={(e) => set('extension', e.target.value.replace(/\D/g, '').slice(0, 6))} />
            </Field>
            <Field label="User Name" required>
              <Input value={f.name} autoComplete="off" onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label="Password" required={!editing} hint={editing ? 'Leave empty to keep the current password' : undefined}>
              <Input type="password" value={f.password} autoComplete="new-password" onChange={(e) => set('password', e.target.value)} />
            </Field>
            <Field label="Description">
              <Textarea rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} />
            </Field>
            <Switch checked={f.active} onCheckedChange={(x) => set('active', x)} label="Active / Deactive" />
          </FormCard>
        }
      >
        <DataTable cardAvatar={(r) => r.u.name} loading={!ready} rows={rows} columns={cols} rowKey={(r) => r.u.id} mobileTitle={(r) => <span className="font-semibold">{r.n}. {r.u.name}</span>} exportName="users" empty={{ icon: Users, title: 'No users yet' }} />
      </FormTable>
    </>
  )
}
