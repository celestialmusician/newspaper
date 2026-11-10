import {
  Activity,
  BadgeCheck,
  BadgeIndianRupee,
  BadgePercent,
  Bell,
  BookOpenText,
  Building,
  CalendarDays,
  CalendarOff,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  FileText,
  FileBarChart,
  Percent,
  Receipt,
  ScrollText,
  TrendingUp,
  UserCheck,
  UserRoundCog,
  HandCoins,
  Handshake,
  Home,
  IndianRupee,
  KeyRound,
  Landmark,
  Languages,
  LayoutDashboard,
  Layers,
  type LucideIcon,
  MapPin,
  Megaphone,
  MessageSquareWarning,
  MonitorSmartphone,
  Newspaper,
  Package,
  PieChart,
  Repeat,
  Route,
  Settings,
  ShieldCheck,
  Tags,
  Truck,
  UserCircle,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react'
import type { Role } from '@/domain/types'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  roles: Role[]
  /** Role-specific label override. */
  labels?: Partial<Record<Role, string>>
  badge?: 'notifications' | 'complaints' | 'queue'
  /** Expandable sub-menu (Agent Console). */
  children?: NavChild[]
}

export interface NavChild {
  to: string
  label: string
  icon: LucideIcon
  /** Heading the entry is listed under inside its drop-down (the legacy "CRM" sub-group of Master). */
  group?: string
}

export interface NavGroup {
  title: string
  items: NavItem[]
}

const ALL: Role[] = ['admin', 'agent', 'executive', 'customer']
const STAFF: Role[] = ['admin', 'agent']

export const NAV: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ALL, labels: { executive: "Today's Round", customer: 'Home' } },
      { to: '/notifications', label: 'Notifications', icon: Bell, roles: ALL, badge: 'notifications' },
    ],
  },
  {
    title: 'Field work',
    items: [
      { to: '/deliveries/today', label: 'Delivery Checklist', icon: ClipboardCheck, roles: ['admin', 'agent', 'executive'], badge: 'queue' },
      { to: '/routes', label: 'Routes & Map', icon: Route, roles: ['admin', 'agent', 'executive'], labels: { executive: 'My Route & Map' } },
      { to: '/collections', label: 'Collections', icon: HandCoins, roles: ['admin', 'agent', 'executive'], labels: { executive: 'Payment Collection' } },
      { to: '/stock', label: 'Stock', icon: Package, roles: ['admin', 'agent', 'executive'], labels: { executive: 'My Load' } },
    ],
  },
  {
    title: 'People',
    items: [
      { to: '/customers', label: 'Customers', icon: Users, roles: ['admin', 'agent', 'executive'], labels: { executive: 'My Customers' } },
      { to: '/agents', label: 'Agents', icon: Landmark, roles: ['admin'] },
      { to: '/executives', label: 'Delivery Executives', icon: Truck, roles: STAFF },
    ],
  },
  {
    title: 'Subscriptions',
    items: [
      { to: '/subscriptions', label: 'Subscriptions', icon: Repeat, roles: ['admin', 'agent', 'customer'], labels: { customer: 'My Subscriptions' } },
      { to: '/calendar', label: 'Delivery Calendar', icon: CalendarDays, roles: ALL },
      { to: '/deliveries', label: 'Delivery History', icon: BookOpenText, roles: ALL },
      { to: '/holidays', label: 'Holidays & Strikes', icon: CalendarOff, roles: STAFF },
    ],
  },
  {
    title: 'Catalogue',
    items: [
      { to: '/products', label: 'Products', icon: Newspaper, roles: STAFF },
      { to: '/pricing', label: 'Pricing', icon: Tags, roles: STAFF },
      { to: '/locations', label: 'Locations', icon: MapPin, roles: STAFF },
    ],
  },
  {
    title: 'Finance',
    items: [
      { to: '/invoices', label: 'Billing & Invoices', icon: FileText, roles: ALL, labels: { customer: 'My Bills', executive: 'Customer Bills' } },
      { to: '/payments', label: 'Payments', icon: Wallet, roles: ['admin', 'agent', 'customer'], labels: { customer: 'Payments & Receipts' } },
      { to: '/discounts', label: 'Discounts', icon: BadgePercent, roles: STAFF },
      { to: '/settlements', label: 'Agent Settlement', icon: IndianRupee, roles: STAFF },
    ],
  },
  {
    title: 'Insights',
    items: [
      { to: '/reports', label: 'Reports', icon: PieChart, roles: STAFF },
      { to: '/complaints', label: 'Complaints', icon: MessageSquareWarning, roles: ['admin', 'agent', 'customer'], badge: 'complaints', labels: { customer: 'Help & Complaints' } },
    ],
  },
  {
    title: 'System',
    items: [
      { to: '/logs', label: 'Back-log', icon: Activity, roles: ['admin'] },
      { to: '/settings', label: 'Settings', icon: Settings, roles: ['admin'] },
      { to: '/profile', label: 'My Profile', icon: UserCircle, roles: ALL },
    ],
  },
]

/** The Super Administrator's menu: exactly the options of the legacy super-admin panel. */
const ADMIN_NAV: NavGroup[] = [
  {
    title: '',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin'] },
      { to: '/accounts', label: 'Active Accounts', icon: BadgeCheck, roles: ['admin'] },
      {
        to: '/agent-console',
        label: 'Agent Console',
        icon: Settings,
        roles: ['admin'],
        children: [
          { to: '/masters/subscription-types', label: 'Subscription Type', icon: CalendarRange },
          { to: '/manage-products', label: 'Manage Products', icon: Newspaper },
          { to: '/product-rates', label: 'Product Wise Rate', icon: Tags },
          { to: '/masters/areas', label: 'Area Masters', icon: MapPin },
          { to: '/masters/languages', label: 'Language', icon: Languages },
          { to: '/masters/product-types', label: 'Product Type', icon: Layers },
          { to: '/masters/payment-modes', label: 'Mode of Pay', icon: CreditCard },
        ],
      },
      { to: '/broadcasts', label: 'Send Information', icon: Megaphone, roles: ['admin'] },
      { to: '/resellers', label: 'Resellers / Agent', icon: Handshake, roles: ['admin'] },
      { to: '/control-room', label: 'Control Room', icon: MonitorSmartphone, roles: ['admin'] },
      { to: '/licence-plans', label: 'Billing', icon: BadgeIndianRupee, roles: ['admin'] },
      { to: '/logs', label: 'BACK - LOG', icon: Activity, roles: ['admin'] },
      { to: '/change-password', label: 'Change Password', icon: KeyRound, roles: ['admin'] },
    ],
  },
]

/** The agency's menu: exactly the options of the legacy agent panel (Master, Transactions, Reports, Settings). */
const AGENT_NAV: NavGroup[] = [
  {
    title: '',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ['agent'] },
      {
        to: '/master',
        label: 'Master',
        icon: Settings,
        roles: ['agent'],
        children: [
          { to: '/masters/subscription-types', label: 'Subscription Type', icon: CalendarRange },
          { to: '/manage-products', label: 'Manage Products', icon: Newspaper },
          { to: '/product-rates', label: 'Product Wise Rate', icon: Tags },
          { to: '/manage-route', label: 'Manage Route', icon: Route },
          { to: '/delivery-boys', label: 'Manage Delivery Boys', icon: Truck },
          { to: '/customers-master', label: 'Customer Details', icon: Users, group: 'CRM' },
          { to: '/manage-subscriptions', label: 'Manage Subscriptions', icon: Repeat, group: 'CRM' },
        ],
      },
      {
        to: '/transactions',
        label: 'Transactions',
        icon: Receipt,
        roles: ['agent'],
        children: [
          { to: '/bill-adjustment', label: 'Manage Bill Adjustment', icon: BadgePercent },
          { to: '/bill', label: 'Bill', icon: FileText },
          { to: '/delivery-slip', label: 'Delivery Slip', icon: ClipboardList },
          { to: '/payment-collection', label: 'Payment Collection Entry', icon: HandCoins },
          { to: '/profit-forecasting', label: 'Profit Forecasting', icon: TrendingUp },
          { to: '/profit-loss', label: 'Profit & Loss Statement', icon: ScrollText },
        ],
      },
      {
        to: '/reports',
        label: 'Reports',
        icon: FileBarChart,
        roles: ['agent'],
        children: [
          { to: '/reports/customer-data', label: 'Customer Data Listing', icon: Users },
          { to: '/reports/customer-subscription', label: 'Customer Wise Subscription', icon: Repeat },
          { to: '/reports/payment-due', label: 'Payment Due', icon: Wallet },
          { to: '/reports/payment-collected', label: 'Payment Collected', icon: IndianRupee },
          { to: '/reports/bill-details', label: 'Bill Details', icon: FileText },
          { to: '/reports/product-list', label: 'Product List', icon: Newspaper },
          { to: '/reports/transfer-delivery', label: 'Transfer Delivery Boy', icon: Truck },
          { to: '/reports/customer-report', label: 'Customer Report', icon: UserCheck },
          { to: '/reports/sales', label: 'Sales Report', icon: PieChart },
        ],
      },
      {
        to: '/settings-menu',
        label: 'Settings',
        icon: UserRoundCog,
        roles: ['agent'],
        children: [
          { to: '/agency-profile', label: 'Profile', icon: Building },
          { to: '/subscription-info', label: 'Subscription Info', icon: BadgeCheck },
          { to: '/bill-serials', label: 'Bill Serials', icon: Receipt },
          { to: '/change-password', label: 'Change Password', icon: KeyRound },
          { to: '/handling-charge', label: 'Handling Charge Setting', icon: Percent },
          { to: '/user-roll', label: 'User Roll', icon: ShieldCheck },
          { to: '/rate-setting', label: 'Rate Setting', icon: Tags },
          { to: '/users', label: 'User', icon: Users },
          { to: '/masters/payment-modes', label: 'Mode of Pay', icon: CreditCard },
        ],
      },
    ],
  },
]

/** Dashboard shortcuts: the most-used screens of each panel, taken from its own menu. */
const QUICK: Partial<Record<Role, string[]>> = {
  admin: ['/accounts', '/manage-products', '/product-rates', '/broadcasts', '/resellers', '/control-room', '/licence-plans'],
  agent: ['/customers-master', '/manage-subscriptions', '/payment-collection', '/bill', '/delivery-slip', '/manage-route', '/delivery-boys', '/reports/sales'],
  executive: ['/deliveries/today', '/routes', '/collections', '/stock', '/customers', '/invoices', '/calendar', '/deliveries'],
  customer: ['/subscriptions', '/calendar', '/invoices', '/payments', '/deliveries', '/complaints', '/notifications', '/profile'],
}

export const quickLinks = (role: Role): { to: string; label: string; icon: LucideIcon }[] => {
  const all = navFor(role).flatMap((g) => g.items.flatMap((i) => (i.children ? i.children : [i]))) as { to: string; label: string; icon: LucideIcon }[]
  return (QUICK[role] ?? []).flatMap((p) => all.filter((a) => a.to === p))
}

/** Header-menu pages (account menu, notification bell) each console can also open. */
const EXTRA: Partial<Record<Role, string[]>> = {
  // '/verification' is the retired approval list: it only redirects to the New accounts tab (old links and notifications).
  admin: ['/notifications', '/profile', '/verification'],
  agent: ['/help', '/notifications', '/invoices', '/profile'],
}

/** Every screen a role can open, sub-menu entries included. */
export const flatNav = (role: Role, allow?: (path: string) => boolean): { to: string; label: string }[] =>
  navFor(role, allow).flatMap((g) => g.items.flatMap((i) => (i.children ? i.children : [i])))

/** Menu of a role. `allow` (staff users) drops pages their User Roll does not open, and drop-downs left empty. */
export const navFor = (role: Role, allow?: (path: string) => boolean): NavGroup[] => {
  const base: NavGroup[] =
    role === 'admin' ? ADMIN_NAV : role === 'agent' ? AGENT_NAV :
    NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.roles.includes(role)).map((i) => ({ ...i, label: i.labels?.[role] ?? i.label })) })).filter((g) => g.items.length)
  if (!allow) return base
  return base
    .map((g) => ({
      ...g,
      items: g.items.flatMap((it): NavItem[] => {
        if (!it.children) return allow(it.to) ? [it] : []
        const kids = it.children.filter((c) => allow(c.to))
        return kids.length ? [{ ...it, children: kids }] : []
      }),
    }))
    .filter((g) => g.items.length)
}

export interface MoreSection {
  title: string
  items: { to: string; label: string; icon: LucideIcon; badge?: NavItem['badge'] }[]
}

/** Everything in the side menu that is not one of the bar's four direct items, grouped like the menu ("More" on phones). */
export const moreSections = (role: Role, exclude: string[], allow?: (path: string) => boolean): MoreSection[] => {
  const groups = navFor(role, allow)
  const grouped = groups.some((g) => g.items.some((i) => i.children))
  const sections = groups.flatMap((g) => {
    const loose: MoreSection['items'] = []
    const nested: MoreSection[] = []
    for (const it of g.items) {
      // One card per drop-down; its sub-group entries (CRM) follow the group's own entries so no card holds a single tile.
      if (it.children) nested.push({ title: it.label, items: [...it.children.filter((c) => !c.group), ...it.children.filter((c) => c.group)].filter((c) => !exclude.includes(c.to)) })
      else if (!exclude.includes(it.to)) loose.push({ to: it.to, label: it.label, icon: it.icon, badge: it.badge })
    }
    return [...(loose.length ? [{ title: g.title || 'Menu', items: loose }] : []), ...nested].filter((s) => s.items.length)
  })
  // Panels without expandable groups (delivery boy, customer) have many one-item sections: show them as a single grid.
  return grouped ? sections : sections.length ? [{ title: 'Menu', items: sections.flatMap((s) => s.items) }] : []
}

/** Four primary destinations for the mobile bottom bar (all of them are also in the side menu). */
export const BOTTOM_NAV: Record<Role, { to: string; label: string; icon: LucideIcon }[]> = {
  admin: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/accounts', label: 'Accounts', icon: BadgeCheck },
    { to: '/control-room', label: 'Online', icon: MonitorSmartphone },
    { to: '/broadcasts', label: 'Send', icon: Megaphone },
  ],
  agent: [
    { to: '/', label: 'Home', icon: Home },
    { to: '/customers-master', label: 'Customers', icon: Users },
    { to: '/payment-collection', label: 'Collect', icon: HandCoins },
    { to: '/bill', label: 'Bills', icon: FileText },
  ],
  executive: [
    { to: '/', label: 'Today', icon: Home },
    { to: '/deliveries/today', label: 'Checklist', icon: ClipboardCheck },
    { to: '/routes', label: 'Route', icon: Route },
    { to: '/collections', label: 'Collect', icon: HandCoins },
  ],
  customer: [
    { to: '/', label: 'Home', icon: Home },
    { to: '/calendar', label: 'Calendar', icon: CalendarDays },
    { to: '/invoices', label: 'Bills', icon: FileText },
    { to: '/subscriptions', label: 'Papers', icon: Repeat },
  ],
}

export const canVisit = (role: Role, path: string) => {
  if (role === 'admin' || role === 'agent') return [...flatNav(role).map((i) => i.to), ...(EXTRA[role] ?? [])].some((to) => (to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`)))
  const base = '/' + (path.split('/')[1] ?? '')
  if (path.startsWith('/deliveries/today')) return role !== 'customer'
  // Exact first segment only: "/deliveries" (history) must not resolve to "/deliveries/today" (checklist).
  const item = NAV.flatMap((g) => g.items).find((i) => i.to === base)
  // Anything that is not one of the role's own screens (console pages, agency settings…) is closed.
  return item ? item.roles.includes(role) : false
}

export const ROLE_ICON: Record<Role, LucideIcon> = { admin: UserCog, agent: Landmark, executive: Truck, customer: UserCircle }
