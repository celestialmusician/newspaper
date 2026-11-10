import { AnimatePresence, motion } from 'motion/react'
import {
  Bell,
  Building2,
  ChevronDown,
  ChevronsLeft,
  Download,
  type LucideIcon,
  LogOut,
  MoreHorizontal,
  Palette,
  Phone,
  UserCircle,
  UserRound,
  WifiOff,
  X,
} from 'lucide-react'
import * as React from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { IdleCourier, ModeToggle, Newsprint, ThemeMenu, WelcomeVeil } from '@/components/fx/Appearance'
import { Button } from '@/components/ui/button'
import { Avatar, TONE_INK } from '@/components/ui/misc'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/overlay'
import { userName } from '@/domain/access'
import { ROLE_LABEL } from '@/domain/types'
import { staffOf } from '@/domain/staff'
import { useActor, useCanOpen, useData, useMyNotifications } from '@/hooks/app'
import { useScrollReveal } from '@/hooks/scrollReveal'
import { fmtDateTime, relativeTime } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { auth, licences as licenceApi, notifications as notifApi } from '@/services/api'
import { useNetwork } from '@/services/offline'
import { useSession } from '@/services/store'
import { BOTTOM_NAV, moreSections, navFor, type NavItem } from './nav'
import { promptInstall, useInstall } from './pwa'

export function Logo({ compact, light }: { compact?: boolean; light?: boolean }) {
  return (
    <span className="group/logo flex items-center gap-2.5 [perspective:400px]">
      <span
        className={cn(
          'logo-shine relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-[10px] font-serif text-[22px] font-bold leading-none shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_8px_18px_-8px_var(--glow)] transition-transform duration-500 ease-out-expo group-hover/logo:[transform:rotateY(-24deg)]',
          light ? 'bg-white/15 text-white ring-1 ring-white/30' : 'bg-brand-gradient text-white',
        )}
      >
        N<span className={cn('idle-live absolute bottom-1.5 right-1.5 size-1.5 rounded-full', light ? 'bg-white' : 'bg-white/80')} />
      </span>
      {!compact && (
        <span className="leading-none">
          <span className={cn('block font-serif text-[21px] font-extrabold', light ? 'text-white' : 'text-primary')}>
            News<span className={light ? 'text-white/70' : 'text-gradient'}>Round</span>
          </span>
          <span className={cn('kicker mt-1 block text-[9px]', light ? 'text-white/50' : 'text-muted-foreground')}>Agency Suite</span>
        </span>
      )}
    </span>
  )
}

function useBadges() {
  const db = useData()
  const actor = useActor()
  const notes = useMyNotifications()
  const queue = useNetwork((s) => s.queue)
  return {
    notifications: notes.filter((n) => !n.read).length,
    complaints: actor.role === 'customer' ? 0 : db.complaints.filter((c) => c.status !== 'resolved' && (actor.role === 'admin' || db.customers.find((x) => x.id === c.customerId)?.agentId === actor.userId)).length,
    queue: queue.length,
    verification: actor.role === 'admin' ? db.accountRequests.filter((r) => r.status === 'pending').length : 0,
  }
}

/** An expandable sidebar entry (Agent Console) that opens by itself when one of its pages is showing. */
function NavParent({ item, collapsed, onNavigate, delay }: { item: NavItem; collapsed?: boolean; onNavigate?: () => void; delay: number }) {
  const loc = useLocation()
  const kids = item.children!
  const within = kids.some((k) => loc.pathname === k.to || loc.pathname.startsWith(`${k.to}/`))
  const [open, setOpen] = React.useState(within)
  React.useEffect(() => {
    if (within) setOpen(true)
  }, [within])
  const base = 'group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-medium transition-[background-color,color,transform] duration-300 ease-out-expo'
  const chip = (on: boolean) => cn('relative grid size-7 shrink-0 place-items-center rounded-lg transition-colors', on ? 'bg-brand-gradient text-white shadow-[0_6px_14px_-6px_var(--glow)]' : 'bg-white/10 text-white/80 group-hover:bg-white/20 group-hover:text-white')
  return (
    <li style={{ animationDelay: `${delay}ms` }} className="nav-in">
      {collapsed ? (
        <NavLink to={kids[0]!.to} onClick={onNavigate} title={item.label} className={cn(base, 'justify-center px-0', within ? 'text-white' : 'text-white/75 hover:bg-white/10 hover:text-white')}>
          <span className={chip(within)}>
            <item.icon className="spin3d size-[16px]" />
          </span>
        </NavLink>
      ) : (
        <>
          <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={cn(base, within ? 'bg-white/10 text-white' : 'text-white/75 hover:translate-x-1 hover:bg-white/10 hover:text-white')}>
            <span className={chip(within)}>
              <item.icon className="spin3d size-[16px]" />
            </span>
            <span className="relative flex-1 truncate text-left">{item.label}</span>
            <ChevronDown className={cn('size-4 shrink-0 text-white/60 transition-transform duration-300', open && 'rotate-180')} />
          </button>
          <AnimatePresence initial={false}>
            {open && (
              <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }} className="ml-[26px] mt-0.5 space-y-0.5 overflow-hidden border-l border-white/15 pl-2.5">
                {kids.map((k) => (
                  <li key={k.to}>
                    <NavLink to={k.to} onClick={onNavigate} className={({ isActive }) => cn('group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] transition-[background-color,color,transform] duration-300', isActive ? 'bg-white font-semibold text-[#11142a] shadow-[0_8px_20px_-10px_rgba(0,0,0,0.55)]' : 'text-white/70 hover:translate-x-1 hover:bg-white/10 hover:text-white')}>
                      {({ isActive }) => (
                        <>
                          <k.icon className={cn('size-[15px] shrink-0', isActive ? 'text-[var(--brand)]' : 'text-white/60 group-hover:text-white')} />
                          <span className="truncate">{k.label}</span>
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </>
      )}
    </li>
  )
}

function SidebarNav({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const actor = useActor()
  const badges = useBadges()
  const canOpen = useCanOpen()
  const groups = navFor(actor.role, canOpen)
  return (
    <nav className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-3 pb-6">
      {groups.map((g, gi) => (
        <div key={g.title || gi}>
          {!g.title ? null : collapsed ? <div className="mx-4 mb-2 border-t border-white/10" /> : <div style={{ animationDelay: `${Math.min(gi * 90, 600)}ms` }} className="nav-in kicker mb-1.5 px-3 text-white/45">{g.title}</div>}
          <ul className="space-y-0.5">
            {g.items.map((it, ii) => {
              if (it.children) return <NavParent key={it.to} item={it} collapsed={collapsed} onNavigate={onNavigate} delay={Math.min(gi * 90 + (ii + 1) * 45, 700)} />
              const count = it.badge ? badges[it.badge] : 0
              return (
                <li key={it.to} style={{ animationDelay: `${Math.min(gi * 90 + (ii + 1) * 45, 700)}ms` }} className="nav-in">
                  <NavLink
                    to={it.to}
                    end={it.to === '/' || it.to === '/deliveries'}
                    onClick={onNavigate}
                    title={collapsed ? it.label : undefined}
                    className={({ isActive }) =>
                      cn(
                        'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-medium transition-[background-color,color,transform] duration-300 ease-out-expo',
                        isActive ? 'font-semibold text-[#11142a]' : 'text-white/75 hover:translate-x-1 hover:bg-white/10 hover:text-white',
                        collapsed && 'justify-center px-0',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && <motion.span layoutId="nav-active" transition={{ type: 'spring', stiffness: 460, damping: 36 }} className="absolute inset-0 rounded-xl bg-white shadow-[0_10px_26px_-10px_rgba(0,0,0,0.55)]" />}
                        {isActive && <span aria-hidden className="nav-pulse pointer-events-none absolute -inset-px rounded-xl" />}
                        <span className={cn('relative grid size-7 shrink-0 place-items-center rounded-lg transition-colors', isActive ? 'bg-brand-gradient text-white shadow-[0_6px_14px_-6px_var(--glow)]' : 'bg-white/10 text-white/80 group-hover:bg-white/20 group-hover:text-white')}>
                          <it.icon className="spin3d size-[16px]" />
                        </span>
                        {!collapsed && <span className="relative flex-1 truncate">{it.label}</span>}
                        {count > 0 && (
                          <span className={cn('relative grid min-w-5 place-items-center rounded-full px-1.5 text-[10.5px] font-bold', isActive ? 'bg-brand-gradient text-white' : 'bg-white/20 text-white', collapsed && 'absolute right-1 top-0.5 min-w-4 text-[9.5px]')}>{count}</span>
                        )}
                      </>
                    )}
                  </NavLink>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}


/**
 * Desktop menu (Super Administrator and agency): a floating glass rail under the header. Each
 * entry is an icon tile over its label, all on one row; when the screen is too narrow the rail
 * scrolls sideways with faded edges instead of wrapping. The open page has a gradient icon chip
 * and an ink bar that slides between entries. Groups still open as drop-downs.
 */
function TopNav() {
  const actor = useActor()
  const badges = useBadges()
  const loc = useLocation()
  const navigate = useNavigate()
  const canOpen = useCanOpen()
  const items = navFor(actor.role, canOpen).flatMap((g) => g.items)
  const railRef = React.useRef<HTMLUListElement>(null)
  // Keep the open page's entry in view when the rail scrolls (sideways only, never the page).
  React.useEffect(() => {
    const rail = railRef.current
    const el = rail?.querySelector<HTMLElement>('[aria-current="page"], [data-on="true"]')
    if (!rail || !el) return
    const r = el.getBoundingClientRect()
    const b = rail.getBoundingClientRect()
    if (r.left < b.left || r.right > b.right) rail.scrollBy({ left: r.left - b.left - (b.width - r.width) / 2 })
  }, [loc.pathname])
  const ink = <motion.span layoutId="rail-ink" transition={{ type: 'spring', stiffness: 460, damping: 36 }} className="rail-ink" aria-hidden />
  const tile = (Icon: LucideIcon, label: string, on: boolean, count = 0, chevron = false) => (
    <>
      <span className="rail-chip">
        <Icon className="size-[17px]" />
        {count > 0 && <span className="rail-badge">{count}</span>}
      </span>
      <span className="rail-label">
        {label}
        {chevron && <ChevronDown className="rail-caret" />}
      </span>
      {on && ink}
    </>
  )
  return (
    <nav aria-label="Main menu" className="no-print hidden px-4 pt-3 sm:px-6 md:block lg:px-8">
      <div className="nav-rail mx-auto max-w-[1400px]">
        <ul ref={railRef} className="rail-list">
          {items.map((it, i) => {
            const delay = { animationDelay: `${Math.min(i * 40, 440)}ms` }
            if (it.children) {
              const within = it.children.some((k) => loc.pathname === k.to || loc.pathname.startsWith(`${k.to}/`))
              return (
                <li key={it.to} style={delay} className="nav-in">
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <button type="button" data-on={within} className="rail-item">
                        {tile(it.icon, it.label, within, 0, true)}
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="max-h-[70vh] min-w-60 overflow-y-auto">
                      {it.children.map((k, ki) => {
                        const on = loc.pathname === k.to || loc.pathname.startsWith(`${k.to}/`)
                        return (
                          <React.Fragment key={k.to}>
                            {k.group && k.group !== it.children![ki - 1]?.group && (
                              <>
                                {ki > 0 && <DropdownMenuSeparator />}
                                <DropdownMenuLabel>{k.group}</DropdownMenuLabel>
                              </>
                            )}
                            <DropdownMenuItem onSelect={() => navigate(k.to)} className={cn(k.group && 'pl-5', on && 'bg-accent font-semibold text-primary')}>
                              <k.icon /> {k.label}
                            </DropdownMenuItem>
                          </React.Fragment>
                        )
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              )
            }
            const count = it.badge ? badges[it.badge] : 0
            return (
              <li key={it.to} style={delay} className="nav-in">
                <NavLink to={it.to} end={it.to === '/'} className="rail-item">
                  {({ isActive }) => tile(it.icon, it.label, isActive, count)}
                </NavLink>
              </li>
            )
          })}
        </ul>
      </div>
    </nav>
  )
}

function NotificationBell() {
  const notes = useMyNotifications()
  const unread = notes.filter((n) => !n.read)
  const navigate = useNavigate()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="soft-raised relative rounded-full" aria-label={`Notifications (${unread.length} unread)`}>
          <Bell className={cn('size-5', unread.length > 0 && 'idle-ring')} />
          {unread.length > 0 && <span className="animate-pop absolute right-1 top-1 grid min-w-[18px] place-items-center rounded-[4px] bg-brand-gradient px-1 font-mono text-[10px] font-bold leading-[18px] text-white ring-2 ring-background">{unread.length}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,380px)] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="font-display text-lg font-semibold text-primary">Notifications</div>
          {unread.length > 0 && (
            <button className="text-[12.5px] font-semibold text-primary hover:underline" onClick={() => void notifApi.markRead(unread.map((n) => n.id))}>
              Mark all read
            </button>
          )}
        </div>
        <ul className="max-h-[60vh] divide-y divide-border/60 overflow-y-auto">
          {notes.slice(0, 8).map((n) => (
            <li key={n.id}>
              <button
                className={cn('flex w-full gap-3 px-4 py-3 text-left hover:bg-accent/60', !n.read && 'bg-masthead/[0.04]')}
                onClick={() => {
                  void notifApi.markRead([n.id])
                  if (n.link) navigate(n.link)
                }}
              >
                <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-masthead')} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold">{n.title}</span>
                  <span className="line-clamp-2 block text-[12.5px] text-muted-foreground">{n.body}</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground/80">{relativeTime(n.at)}</span>
                </span>
              </button>
            </li>
          ))}
          {!notes.length && <li className="px-4 py-8 text-center text-sm text-muted-foreground">You're all caught up.</li>}
        </ul>
        <div className="border-t border-border p-2">
          <Button variant="ghost" className="w-full" asChild>
            <Link to="/notifications">Open notification centre</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function UserMenu() {
  const db = useData()
  const actor = useActor()
  const staff = staffOf(db, actor)
  const name = staff?.name ?? userName(db, actor.userId)
  const roleLabel = staff ? 'Staff user' : ROLE_LABEL[actor.role]
  const navigate = useNavigate()
  const install = useInstall()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2.5 rounded-md py-1 pl-1 pr-1 transition-colors hover:bg-accent sm:pr-3" aria-label="Account menu">
          <Avatar name={name} size={34} className="chip-3d ring-2 ring-background" />
          <span className="hidden text-left leading-tight lg:block">
            <span className="block text-[13.5px] font-semibold">{name}</span>
            <span className="block text-[11.5px] text-muted-foreground">{roleLabel}</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <DropdownMenuLabel>{roleLabel}</DropdownMenuLabel>
        {/* The profile page is the owner's own (mobile, MPIN), so staff users do not get it. */}
        {!staff && (
          <DropdownMenuItem onSelect={() => navigate('/profile')}>
            <UserCircle /> My profile
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => navigate('/notifications')}>
          <Bell /> Notification centre
        </DropdownMenuItem>
        {actor.role === 'agent' && (
          <DropdownMenuItem onSelect={() => navigate('/help')}>
            <Phone /> Help
          </DropdownMenuItem>
        )}
        {!staff && (
          <DropdownMenuItem onSelect={() => navigate('/profile#appearance')}>
            <Palette /> Appearance
          </DropdownMenuItem>
        )}
        {!install.installed && (
          <DropdownMenuItem onSelect={() => void promptInstall()}>
            <Download /> Install app
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          destructive
          onSelect={() => {
            auth.logout()
            navigate('/login')
          }}
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const BAR_TONES = [TONE_INK.accent, TONE_INK.success, TONE_INK.warning, TONE_INK.info, TONE_INK.danger] as const

const MORE_TONES = [TONE_INK.accent, TONE_INK.success, TONE_INK.warning, TONE_INK.info, TONE_INK.danger, TONE_INK.navy] as const

/** Tile captions that would need three lines in the phone grid. */
const SHORT_LABEL: Record<string, string> = {
  'Customer Wise Subscription': 'Customer Subscription',
  'Handling Charge Setting': 'Handling Charge',
  'Manage Bill Adjustment': 'Bill Adjustment',
  'Manage Delivery Boys': 'Delivery Boys',
  'Manage Subscriptions': 'Subscriptions',
}
const tileLabel = (l: string) => {
  const s = l.replace(/^CRM · /, '')
  return SHORT_LABEL[s] ?? s
}

/** Phone navigation: the four most important menu items sit in the bar; "More" opens the rest of the menu right above it. */
function BottomNav() {
  const actor = useActor()
  const badges = useBadges()
  const loc = useLocation()
  // Open only for the page it was opened on, so any navigation closes it without an effect.
  const [openFor, setOpenFor] = React.useState<string | null>(null)
  const open = openFor === loc.pathname
  const close = () => setOpenFor(null)
  const canOpen = useCanOpen()
  // Staff users only get the bar items their User Roll opens.
  const items = BOTTOM_NAV[actor.role].filter((i) => canOpen(i.to))
  const sections = React.useMemo(() => moreSections(actor.role, BOTTOM_NAV[actor.role].map((i) => i.to), canOpen), [actor.role, canOpen])
  const onPath = (to: string) => (to === '/' ? loc.pathname === '/' : loc.pathname === to || loc.pathname.startsWith(`${to}/`))
  const moreActive = sections.some((s) => s.items.some((i) => onPath(i.to)))
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpenFor(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  // Every item is the same size and sits on the same baseline; the open page is shown by a white ring, a glow and a bold label (no vertical shifting).
  const item = 'group relative flex h-[64px] w-full flex-col items-center justify-start gap-1 rounded-2xl pt-2 text-[10.5px] font-semibold leading-none max-[359px]:text-[9.5px] max-[359px]:tracking-[-0.02em] transition-colors duration-200 active:scale-95'
  const chip = 'dock-chip chip-3d relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-2xl text-white ring-1 ring-inset transition-[box-shadow,transform] duration-300 ease-out-expo'
  return (
    <>
    {open && <button type="button" aria-label="Close menu" className="no-print fixed inset-0 z-[39] touch-none animate-[fade-in_0.2s_ease-out] bg-black/35 md:hidden" onClick={close} />}
    {/* Same glass dock as the desktop quick actions: tinted frosted bar, glossy 3D chips. Capped and centred so it never stretches on wide phones. */}
    <nav className="dock-bar no-print fixed inset-x-3 bottom-[calc(8px+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-[460px] flex-col gap-2 md:hidden" aria-label="Main">
      {open && (
        <div id="more-menu" role="menu" aria-label="More" className="dock-glass origin-bottom animate-[pop-in_0.22s_var(--ease-out-expo)] overflow-hidden rounded-[26px]">
          {/* Scrolls inside the panel; the soft fade top and bottom shows there is more. One colour per section keeps the grid calm. */}
          <div className="scrollbar-thin max-h-[min(60dvh,520px)] space-y-2.5 overflow-y-auto overscroll-contain px-2.5 py-3 [mask-image:linear-gradient(to_bottom,transparent,#000_10px,#000_calc(100%-14px),transparent)]">
            {sections.map((s, si) => (
              <section key={s.title} aria-label={s.title} className="rounded-2xl bg-black/12 px-1.5 pb-1.5 pt-2 ring-1 ring-inset ring-white/12">
                <div className="flex items-center gap-2 px-1.5 pb-1">
                  <h2 className="kicker font-display text-[10.5px] text-white/75">{s.title}</h2>
                  <span aria-hidden className="h-px flex-1 bg-white/15" />
                  <span className="text-[10px] font-semibold tabular-nums text-white/50">{s.items.length}</span>
                </div>
                <ul className="grid grid-cols-3 gap-x-0.5 gap-y-0.5 min-[370px]:grid-cols-4">
                  {s.items.map((l) => {
                    const on = onPath(l.to)
                    const count = l.badge ? badges[l.badge] : 0
                    return (
                      <li key={l.to} className="min-w-0">
                        <Link role="menuitem" to={l.to} onClick={close} aria-current={on ? 'page' : undefined} title={l.label.replace(/^CRM · /, '')} className={cn('relative flex h-[84px] flex-col items-center gap-1.5 rounded-xl px-0.5 pt-2 text-center transition-colors duration-200 active:scale-95 active:bg-white/10', on && 'bg-white/14 ring-1 ring-inset ring-white/35')}>
                          <span className="dock-chip chip-3d relative grid size-10 place-items-center overflow-hidden rounded-[14px] text-white ring-1 ring-inset ring-white/30" style={{ background: MORE_TONES[si % MORE_TONES.length] }}>
                            <l.icon className="relative size-[19px] drop-shadow-[0_1px_1px_rgba(0,0,0,0.25)]" />
                          </span>
                          {count > 0 && <span className="absolute right-1 top-1 z-10 grid min-w-[17px] place-items-center rounded-full bg-white px-1 text-[10px] font-bold leading-[17px] text-[#11142a]">{count}</span>}
                          <span className={cn('line-clamp-2 w-full break-words px-0.5 text-[10.5px] font-semibold leading-[1.2] text-white/85', on && 'font-bold text-white')}>{tileLabel(l.label)}</span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}
      <ul className="dock-glass grid items-stretch rounded-[26px] px-1.5 py-1.5" style={{ gridTemplateColumns: `repeat(${items.length + (sections.length ? 1 : 0)}, minmax(0, 1fr))` }}>
        {items.map((it, i) => (
          <li key={it.to} className="min-w-0">
            <NavLink to={it.to} end={it.to === '/'} className={({ isActive }) => cn(item, isActive ? 'text-white' : 'text-white/75')}>
              {({ isActive }) => (
                <>
                  <span className={cn(chip, isActive ? 'scale-105 ring-2 ring-white/90 shadow-[0_8px_18px_-6px_var(--glow)]' : 'ring-white/30')} style={{ background: BAR_TONES[i % BAR_TONES.length] }}>
                    <it.icon className={cn('relative size-[20px] drop-shadow-[0_1px_1px_rgba(0,0,0,0.25)]', isActive && 'flip-on')} />
                  </span>
                  <span className={cn('max-w-full truncate', isActive && 'font-bold text-white')}>{it.label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
        {sections.length > 0 && <li className="min-w-0">
          <button type="button" aria-expanded={open} aria-controls="more-menu" onClick={() => setOpenFor(open ? null : loc.pathname)} className={cn(item, open || moreActive ? 'text-white' : 'text-white/75')}>
            <span className={cn(chip, 'bg-white/15', open || moreActive ? 'scale-105 ring-2 ring-white/90 shadow-[0_8px_18px_-6px_var(--glow)]' : 'ring-white/30')}>
              {open ? <X className="relative size-[20px]" /> : <MoreHorizontal className="relative size-[20px]" />}
            </span>
            <span className={cn((open || moreActive) && 'font-bold')}>More</span>
          </button>
        </li>}
      </ul>
    </nav>
    </>
  )
}

/** Customer-only floating call button: tap to ring the customer's own agent or the agency. */
function SupportCta() {
  const db = useData()
  const actor = useActor()
  const me = db.customers.find((c) => c.id === actor.userId)
  const agent = db.agents.find((x) => x.id === me?.agentId)
  const options: { key: string; icon: LucideIcon; title: string; name: string; phone: string }[] = []
  if (agent?.mobile) options.push({ key: 'agent', icon: UserRound, title: 'Call your agent', name: agent.name, phone: agent.mobile })
  if (db.settings.supportPhone) options.push({ key: 'agency', icon: Building2, title: 'Call the agency', name: db.settings.agencyName, phone: db.settings.supportPhone })
  if (!options.length) return null
  return (
    <div className="support-cta no-print fixed bottom-[calc(6.5rem+env(safe-area-inset-bottom))] right-4 z-30 animate-pop [animation-delay:700ms] md:bottom-8 md:right-8">
      <div className="cta-bob relative">
        <span aria-hidden className="cta-ring" />
        <Popover>
          <PopoverTrigger asChild>
            <button
              aria-label="Call customer support"
              className="group relative flex h-12 items-center gap-2.5 rounded-full bg-brand-gradient bg-[length:160%_160%] bg-left pl-2 pr-5 text-[14px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_16px_32px_-10px_var(--glow)] transition-[background-position,box-shadow,transform] duration-500 hover:bg-right hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_20px_40px_-10px_var(--glow)] active:scale-95"
            >
              <span className="grid size-8 place-items-center rounded-full bg-white/25 ring-1 ring-inset ring-white/40">
                <Phone className="cta-phone size-4" strokeWidth={2.5} />
              </span>
              Call support
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-[19rem]">
            <div className="kicker px-1 pb-2 text-muted-foreground">Customer support</div>
            <ul className="space-y-1">
              {options.map((o) => (
                <li key={o.key}>
                  <a href={`tel:+91${o.phone}`} className="group/row flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-accent">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-gradient text-white shadow-[0_8px_18px_-8px_var(--glow)]">
                      <o.icon className="size-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-semibold">{o.title}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">
                        {o.name} · +91 {o.phone}
                      </span>
                    </span>
                    <Phone className="size-4 shrink-0 text-primary transition-transform duration-300 group-hover/row:rotate-12" />
                  </a>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}

/** Shown while the super administrator is inside an agency account ("Root login"). */
function RootLoginBar() {
  const returnTo = useSession((s) => s.session?.returnTo)
  const db = useData()
  const navigate = useNavigate()
  const userId = useSession((s) => s.session?.userId)
  if (!returnTo) return null
  const agency = db.agents.find((a) => a.id === userId)?.agencyName ?? 'this agency'
  return (
    <div className="no-print flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-masthead/30 bg-masthead/12 px-4 py-2 text-[13px] font-medium text-masthead sm:px-6">
      <span>
        Root login — you are viewing <b>{agency}</b> as the super administrator.
      </span>
      <Button
        size="sm"
        variant="outline"
        className="ml-auto"
        onClick={() => {
          licenceApi.returnFromRoot()
          navigate('/accounts')
        }}
      >
        Back to administrator
      </Button>
    </div>
  )
}

/** Scroll progress under the header: a strip of newsprint unrolls as the page is read (index.css `.press-run`). */
function PressRun() {
  return (
    <div className="press-run no-print" aria-hidden>
      <i />
      <b>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round">
          <circle cx="8" cy="8" r="7" fill="var(--card)" strokeWidth={1.6} />
          <path d="M8 8.4a.9.9 0 1 1 .9-.9c0 1.6-1.2 2.6-2.6 2.6a2.8 2.8 0 0 1-2.8-2.8A4 4 0 0 1 7.6 3.3a4.7 4.7 0 0 1 4.7 4.7" strokeWidth={1.2} />
          <path d="M3.2 3.6l9.6 8.8" strokeWidth={1.6} opacity={0.55} />
        </svg>
      </b>
    </div>
  )
}

export function Shell() {
  const [collapsed, setCollapsed] = React.useState(() => localStorage.getItem('nap.sidebar') === '1')
  const loc = useLocation()
  const db = useData()
  const actor = useActor()
  const forced = useNetwork((s) => s.forcedOffline)
  const online = useNetwork((s) => s.browserOnline) && !forced
  const mainRef = React.useRef<HTMLElement>(null)
  useScrollReveal(mainRef)

  React.useEffect(() => {
    localStorage.setItem('nap.sidebar', collapsed ? '1' : '0')
  }, [collapsed])
  React.useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [loc.pathname])
  // While the page is being scrolled the ambient animations pause (index.css), so touch scrolling stays smooth on phones.
  React.useEffect(() => {
    const root = document.documentElement
    let t = 0
    const onScroll = () => {
      if (!root.dataset.scrolling) root.dataset.scrolling = '1'
      window.clearTimeout(t)
      t = window.setTimeout(() => delete root.dataset.scrolling, 160)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.clearTimeout(t)
      delete root.dataset.scrolling
    }
  }, [])

  const canOpen = useCanOpen()
  // The Super Administrator and the agency use the legacy layout: a menu bar across the top, no sidebar.
  const topMenu = actor.role === 'admin' || actor.role === 'agent'
  const welcome = actor.role === 'agent' ? db.agents.find((a) => a.id === actor.userId)?.agencyName ?? db.settings.agencyName : ROLE_LABEL[actor.role]
  const lastLogin = actor.role === 'agent' ? db.licences.find((l) => l.agentId === actor.userId) : undefined
  // Width taken by the sidebar, so bottom-centred floating bars (quick actions dock) centre on the content.
  React.useEffect(() => {
    document.documentElement.style.setProperty('--shell-left', topMenu ? '0px' : collapsed ? '76px' : '264px')
  }, [topMenu, collapsed])

  const section = navFor(actor.role, canOpen)
    .flatMap((g) => g.items.flatMap((i) => (i.children ? i.children : [i])))
    .filter((it) => (it.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(it.to)))
    .sort((a, b) => b.to.length - a.to.length)[0]

  return (
    <div className="min-h-dvh overflow-x-clip">
      <Newsprint />
      <WelcomeVeil />
      {/* Desktop sidebar on the palette's deep gradient */}
      {!topMenu && (
      <aside
        className={cn(
          'grad-deep flow-down no-print fixed inset-y-0 left-0 z-30 hidden flex-col overflow-hidden text-white shadow-[8px_0_40px_-20px_var(--glow)] transition-[width] duration-300 ease-out-expo md:flex',
          collapsed ? 'w-[76px]' : 'w-[264px]',
        )}
      >
        <span aria-hidden className="flow-beam" />
        <div className={cn('mx-3 flex h-[68px] items-center px-2', collapsed && 'justify-center px-0')}>
          <Link to="/">
            <Logo compact={collapsed} light />
          </Link>
        </div>
        {!collapsed && (
          <div className="sheen relative mx-3 mb-4 overflow-hidden rounded-xl bg-white/[0.08] px-3 py-2.5 ring-1 ring-inset ring-white/12">
            <span aria-hidden className="sheen-bar" />
            <div className="kicker text-white/50">Agency</div>
            <div className="truncate font-display text-[15px] font-semibold text-white">{db.settings.agencyName}</div>
          </div>
        )}
        <SidebarNav collapsed={collapsed} />
        <button onClick={() => setCollapsed((c) => !c)} className="relative flex h-12 items-center justify-center gap-2 border-t border-white/10 text-[12.5px] font-semibold text-white/60 transition-colors hover:text-white">
          <ChevronsLeft className={cn('size-4 transition-transform', collapsed && 'rotate-180')} />
          {!collapsed && 'Collapse'}
        </button>
      </aside>
      )}

      <div className={cn('transition-[padding] duration-300 ease-out-expo', !topMenu && (collapsed ? 'md:pl-[76px]' : 'md:pl-[264px]'))}>
        <div className="sticky top-0 z-20">
        <header className="app-head glass no-print flex h-16 items-center gap-1.5 border-b border-rule/70 px-3 sm:gap-2 sm:px-6 md:h-[68px]">
          {/* Phones: no side menu any more (the bottom bar and its More panel hold every page), so the header shows the logo and where you are. */}
          <Link to="/" className="md:hidden" aria-label="Home">
            <Logo compact />
          </Link>
          <div className="min-w-0 flex-1 pl-1 md:hidden">
            <div key={section?.to} className="animate-ink truncate font-display text-[17px] font-semibold leading-tight tracking-[-0.02em] text-primary">{section?.label ?? 'NewsRound'}</div>
          </div>
          {topMenu && (
            <Link to="/" className="mr-3 hidden md:block">
              <Logo />
            </Link>
          )}
          <div className="hidden min-w-0 flex-1 md:block">
            {topMenu ? (
              <>
                <div className="kicker text-muted-foreground">Welcome</div>
                <div className="truncate font-display text-[18px] font-semibold leading-tight tracking-[-0.02em] text-primary">{welcome}</div>
              </>
            ) : (
              <>
                <div className="kicker text-muted-foreground">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
                <div key={section?.to} className="animate-ink truncate font-display text-[18px] font-semibold leading-tight tracking-[-0.02em] text-primary">{section?.label ?? 'NewsRound'}</div>
              </>
            )}
          </div>
          {lastLogin?.lastLoginAt && (
            <div className="hidden text-right text-[12px] leading-tight text-muted-foreground xl:block">
              <div className="kicker">Last login</div>
              <div className="font-medium text-foreground/80">
                {fmtDateTime(lastLogin.lastLoginAt)}
                {lastLogin.lastIp ? ` · IP ${lastLogin.lastIp}` : ''}
              </div>
            </div>
          )}
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <ModeToggle />
            <span className="hidden sm:contents">
              <ThemeMenu />
            </span>
            <NotificationBell />
            <UserMenu />
          </div>
        </header>
        {topMenu && <TopNav />}
        <IdleCourier className="absolute inset-x-0 top-full h-6 text-primary/45" />
        <PressRun />
        </div>

        <RootLoginBar />

        <AnimatePresence>
          {!online && (
            <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="no-print overflow-hidden border-b border-warning/30 bg-warning/12">
              <div className="flex items-center gap-2 px-4 py-2 text-[13px] font-medium text-warning sm:px-6">
                <WifiOff className="size-4" /> You are offline. Delivery updates and cash collections are saved on this device and will sync automatically.
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <main ref={mainRef} className={cn('mx-auto w-full max-w-[1400px] px-4 pb-36 pt-5 sm:px-6 sm:pt-7 md:pb-32 lg:px-8')}>
          <div key={loc.pathname} className="page-in">
            <Outlet />
          </div>
        </main>
      </div>

      <BottomNav />
      {actor.role === 'customer' && <SupportCta />}
    </div>
  )
}

