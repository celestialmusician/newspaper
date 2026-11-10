// Core domain model. Mirrors backend/ Django models so the mock service
// layer can be swapped for the REST API without touching screens.

export type ID = string
export type ISODate = string // yyyy-MM-dd
export type ISODateTime = string

export type Role = 'admin' | 'agent' | 'executive' | 'customer'

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Super Administrator',
  agent: 'Agency Owner',
  executive: 'Delivery Executive',
  customer: 'Customer / Subscriber',
}

export type AccountStatus = 'active' | 'inactive'

// ---------- Locations ----------
export type LocationLevel = 'country' | 'state' | 'district' | 'city' | 'locality' | 'area'
export const LOCATION_LEVELS: LocationLevel[] = ['country', 'state', 'district', 'city', 'locality', 'area']

export interface LocationNode {
  id: ID
  level: LocationLevel
  name: string
  parentId: ID | null
  pincode?: string
  lat?: number
  lng?: number
  createdBy?: ID
}

// ---------- People ----------
export interface Admin {
  id: ID
  name: string
  mobile: string
  email: string
  status: AccountStatus
}

export interface AgencyProfile {
  licenseeName?: string
  address?: string
  location?: string
  pincode?: string
  phone?: string
  areaId?: ID
  logo?: string
  billAddress?: string
  billEmail?: string
  billPhone?: string
  billMobile?: string
  gstNo?: string
  panNo?: string
  branches?: number
}

export interface Agent {
  id: ID
  code: string
  /** Bill Serials: invoice number prefix and first number for this agency. */
  billPrefix?: string
  billStart?: number
  /** Rate Setting: bill customers flagged Sub-agent at the sub-agent rate. */
  subAgentBilling?: boolean
  /** Profile > Account Information and Billing Printout Details. */
  profile?: AgencyProfile
  name: string
  mobile: string
  email: string
  agencyName: string
  areaIds: ID[]
  maxDiscountPct: number // authorised discount ceiling for this agent
  canManageRoutes: boolean
  joiningDate: ISODate
  status: AccountStatus
}

export interface Executive {
  id: ID
  code: string
  name: string
  mobile: string
  agentId: ID
  areaIds: ID[]
  joiningDate: ISODate
  status: AccountStatus
  canCollectCash: boolean
  email?: string
  idProof?: IdProof
  idNumber?: string
  address?: string
  photo?: string
  /** Delivery boys can be discontinued without losing their history. */
  discontinuedOn?: ISODate
  discontinueReason?: string
  /** Legacy "Username" of the delivery boy (its password is stored hashed with the credentials, never here). */
  username?: string
  /** Second number to reach the executive — staff-only, hidden from subscribers. */
  altMobile?: string
  altMobileRelation?: ContactRelation
}

export const CONTACT_RELATIONS = ['Father', 'Mother', 'Spouse', 'Brother', 'Sister', 'Son', 'Daughter', 'Guardian', 'Friend', 'Other'] as const
export type ContactRelation = (typeof CONTACT_RELATIONS)[number]

export type IdProof = 'Aadhaar Card' | 'Voter ID' | 'Driving Licence' | 'PAN Card' | 'None'

export interface Customer {
  id: ID
  code: string
  name: string
  mobile: string
  altMobile?: string
  whatsapp?: string
  email?: string
  gender?: 'Male' | 'Female' | 'Other'
  dob?: ISODate
  areaId: ID // full hierarchy derived from area
  houseName: string
  landmark?: string
  address: string
  lat: number
  lng: number
  agentId: ID
  routeId: ID | null // delivery executive derived from route
  idProof: IdProof
  idNumber?: string
  securityDeposit: number
  handlingCharge: number // monthly handling charge added to invoice
  status: AccountStatus
  registeredOn: ISODate
  selfRegistered?: boolean
  /** Customer Details: serial number on the route, landline, skip-bill and sub-agent flags. */
  serialNo?: string
  landline?: string
  skipBill?: boolean
  subAgent?: boolean
}

// ---------- Catalogue ----------
export const PRODUCT_CATEGORIES = [
  'Malayalam Newspapers',
  'English Newspapers',
  'Regional Newspapers',
  'Weekly Magazines',
  'Fortnightly Magazines',
  'Monthly Magazines',
  "Children's Magazines",
  'Educational Publications',
  'Comics and Story Books',
  'Other Printed Publications',
] as const
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number]

/** Drawn from the Product types master; the four classics are always available. */
export type ProductType = 'Newspaper' | 'Magazine' | 'Periodical' | 'Book' | (string & {})
export type ProductStatus = 'active' | 'inactive' | 'archived'

export interface Product {
  id: ID
  code: string
  name: string
  category: ProductCategory
  publisher: string
  language: string
  type: ProductType
  description: string
  image?: string // data URL or path
  availability: 'Available' | 'Limited' | 'Out of stock'
  defaultFrequency: Frequency
  status: ProductStatus
  color: string // brand swatch used for calendar chips
  lowStockThreshold: number
  createdOn: ISODate
  // ---- Publication details (Manage Products form) ----
  /** Publishing company, from the Companies master. */
  company?: string
  billCode?: string
  hsnCode?: string
  /** Magazines that come out in numbered issues. */
  haveIssues?: boolean
  maxIssues?: number
  /** Publication weekdays (0=Sun..6=Sat) for daily / weekly titles. */
  publishWeekdays?: number[]
  /** Publication dates of the month (1..31) for fortnightly / monthly titles. */
  publishDates?: number[]
  remark?: string
  /** Label from the Subscription Type master. */
  subscriptionType?: string
  /** Set when an agency created the title itself; unset = shared catalogue from the super administrator. */
  ownerId?: ID
  /** Fortnightly titles: first issue date and days between issues. */
  startDate?: ISODate
  intervalDays?: number
}

/** One row of the Product Wise Rate grids. */
export interface RateRow {
  purchase: number
  sale: number
  agent: number
}
export interface IssueRate extends RateRow {
  issueNo: number
}
export interface SpecialRate extends RateRow {
  from: ISODate
  to: ISODate
  issueNo?: number
}

/** Price version. agentId=null is the base price; agent rows override agent/customer price. */
export interface PriceVersion {
  id: ID
  productId: ID
  agentId: ID | null
  purchasePrice: number // agency purchase price (per copy)
  agentPrice: number
  customerPrice: number
  effectiveFrom: ISODate
  createdBy: ID
  createdAt: ISODateTime
  note?: string
  // ---- Product Wise Rate detail (the headline triple above is what billing falls back to) ----
  monthlyRate?: number
  /** Daily titles: purchase / sale / sub-agent rate for each weekday, index 0 = Sunday. */
  dayRates?: RateRow[]
  /** Titles sold in numbered issues. */
  issueRates?: IssueRate[]
  /** Festival or special-edition rates for a date range. */
  specials?: SpecialRate[]
}

// ---------- Subscriptions ----------
export type Frequency =
  | 'daily'
  | 'weekly'
  | 'twice_weekly'
  | 'every_14_days'
  | 'fortnightly'
  | 'monthly'
  | 'twice_monthly'
  | 'custom'

export const FREQUENCY_META: Record<Frequency, { label: string; hint: string }> = {
  daily: { label: 'Daily', hint: 'One delivery every day' },
  weekly: { label: 'Weekly', hint: 'One delivery per week on the chosen weekday' },
  twice_weekly: { label: 'Twice Weekly', hint: 'Two deliveries per week on two chosen weekdays' },
  every_14_days: { label: 'Every 14 Days', hint: 'One delivery every 14 days counted from the start date' },
  fortnightly: { label: 'Fortnightly', hint: 'Two fixed dates a month — the 1st and the 16th' },
  monthly: { label: 'Monthly', hint: 'One delivery per month on the chosen date' },
  twice_monthly: { label: 'Twice Monthly', hint: 'Two deliveries per month on two chosen dates' },
  custom: { label: 'Custom Schedule', hint: 'Only on dates you pick manually' },
}

export type SubscriptionStatus = 'active' | 'paused' | 'cancelled' | 'expired'

export interface PauseWindow {
  from: ISODate
  to: ISODate | null // null = open-ended pause
  reason?: string
}

export interface Subscription {
  id: ID
  customerId: ID
  productId: ID
  startDate: ISODate
  endDate: ISODate | null
  frequency: Frequency
  weekdays: number[] // 0=Sun..6=Sat (weekly / twice_weekly)
  monthDays: number[] // 1..31 (monthly / twice_monthly)
  customDates: ISODate[]
  quantity: number
  status: SubscriptionStatus
  pauses: PauseWindow[]
  cancelledOn?: ISODate
  createdOn: ISODate
  notes?: string
  /** Individual Day: copies for each weekday (index 0 = Sunday); a 0 means no delivery that day. */
  dayQuantities?: number[]
}

export interface SubscriptionEvent {
  id: ID
  subscriptionId: ID
  at: ISODateTime
  by: ID
  action: 'created' | 'edited' | 'paused' | 'resumed' | 'cancelled' | 'renewed' | 'changed'
  detail: string
}

// ---------- Holidays ----------
export type HolidayType = 'Public Holiday' | 'Newspaper Holiday' | 'Regional Holiday' | 'Strike / Hartal' | 'Special Holiday'

export interface Holiday {
  id: ID
  name: string
  date: ISODate
  type: HolidayType
  /** Location scope. Empty = applies everywhere. Any listed node covers its descendants. */
  locationIds: ID[]
  /** Product scope. Empty = all products. */
  productIds: ID[]
  deliveryApplicable: boolean // true = delivery still happens (informational holiday)
  description: string
}

// ---------- Routes ----------
export interface RouteStop {
  customerId: ID
  instructions?: string
}

export interface Route {
  id: ID
  code: string
  name: string
  areaIds: ID[]
  agentId: ID
  executiveId: ID | null
  stops: RouteStop[] // ordered = delivery sequence
  instructions: string
  status: AccountStatus
  createdOn: ISODate
}

export interface Handover {
  id: ID
  routeId: ID
  fromExecutiveId: ID | null
  toExecutiveId: ID
  at: ISODateTime
  by: ID
  note?: string
}

// ---------- Deliveries ----------
export type DeliveryStatus = 'scheduled' | 'delivered' | 'pending' | 'missed' | 'holiday' | 'paused'

export const MISSED_REASONS = [
  'Customer not available',
  'House locked',
  'Stock shortage',
  'Wrong address',
  'Heavy rain',
  'Gate closed / pet',
  'Customer refused',
  'Other',
] as const

/** Only actual outcomes are persisted; the schedule itself is always derived. Key = `${subscriptionId}|${date}`. */
export interface DeliveryRecord {
  key: string
  subscriptionId: ID
  customerId: ID
  productId: ID
  date: ISODate
  status: 'delivered' | 'missed'
  quantity: number
  executiveId: ID | null
  actualAt: ISODateTime | null
  updatedBy: ID
  updatedAt: ISODateTime
  reason?: string
  remarks?: string
  syncedFromOffline?: boolean
}

// ---------- Stock ----------
export interface StockEntry {
  /** Unique per day + product + agent → one ledger row, never deducted twice. */
  key: string
  date: ISODate
  productId: ID
  agentId: ID
  opening: number
  received: number
  distributed: number
  returned: number
  damaged: number
  reconciled: boolean
  updatedBy: ID
  updatedAt: ISODateTime
}

// ---------- Discounts ----------
export type DiscountKind = 'percentage' | 'fixed'
export type DiscountCategory = 'Customer-Specific' | 'Subscription' | 'Promotional' | 'Long-Term Subscription'

export interface Discount {
  id: ID
  customerId: ID
  subscriptionId: ID | null // null = whole bill
  kind: DiscountKind
  category: DiscountCategory
  value: number
  startDate: ISODate
  expiryDate: ISODate | null
  reason: string
  approvedBy: ID
  createdAt: ISODateTime
  revoked?: boolean
}

// ---------- Billing ----------
export interface InvoiceLine {
  subscriptionId: ID
  productId: ID
  productName: string
  quantity: number // total copies billed
  deliveries: number
  unitPrice: number // snapshot — never recalculated
  agentPrice: number // snapshot for settlement
  purchasePrice: number // snapshot for settlement
  amount: number
}

export interface InvoiceAdjustment {
  id: ID
  label: string
  amount: number // negative = credit
  approvedBy: ID
  at: ISODateTime
}

export type InvoiceStatus = 'unpaid' | 'partial' | 'paid'

export interface Invoice {
  id: ID
  number: string
  customerId: ID
  agentId: ID
  periodStart: ISODate
  periodEnd: ISODate
  issuedOn: ISODate
  dueDate: ISODate
  lines: InvoiceLine[]
  subtotal: number
  discount: number
  handlingCharge: number
  adjustments: InvoiceAdjustment[]
  currentBill: number // subtotal - discount + handling + adjustments
  previousBalance: number // outstanding carried from earlier invoices at issue time
  paid: number // allocated to this invoice's own currentBill
  status: InvoiceStatus
}

export type PaymentMethod = 'UPI' | 'Debit Card' | 'Credit Card' | 'Cash' | 'Agent Collection' | 'Delivery Executive Collection'
export const ONLINE_METHODS: PaymentMethod[] = ['UPI', 'Debit Card', 'Credit Card']
export const OFFLINE_METHODS: PaymentMethod[] = ['Cash', 'Agent Collection', 'Delivery Executive Collection']

export interface Payment {
  id: ID
  receiptNo: string
  customerId: ID
  agentId: ID
  amount: number
  method: PaymentMethod
  date: ISODate
  at: ISODateTime
  collectedBy: ID // user id that recorded it
  allocations: { invoiceId: ID; amount: number }[]
  /** Demo gateway reference. Simulated payments are ALWAYS flagged; never presented as a real gateway txn. */
  gatewayRef?: string
  simulated: boolean
  verified: boolean
  idempotencyKey: string
  note?: string
}

export interface Remittance {
  id: ID
  agentId: ID
  amount: number
  date: ISODate
  reference: string
  recordedBy: ID
}

// ---------- Complaints / Notifications / Logs ----------
export type ComplaintStatus = 'open' | 'in_progress' | 'resolved'
export interface Complaint {
  id: ID
  number: string
  customerId: ID
  category: 'Missed delivery' | 'Late delivery' | 'Damaged copy' | 'Billing' | 'Delivery executive' | 'Other'
  message: string
  status: ComplaintStatus
  createdAt: ISODateTime
  updates: { at: ISODateTime; by: ID; note: string; status: ComplaintStatus }[]
}

export type NotificationKind =
  | 'invoice'
  | 'payment_due'
  | 'payment_success'
  | 'renewal'
  | 'expiry'
  | 'delivery'
  | 'complaint'
  | 'registration'
  | 'subscription'
  | 'stock'
  | 'price'
  | 'route'
  | 'system'

export interface AppNotification {
  id: ID
  /** Recipient: a user id, or a role broadcast like `role:admin`. */
  to: string
  kind: NotificationKind
  title: string
  body: string
  at: ISODateTime
  read: boolean
  link?: string
}

export interface ActivityLog {
  id: ID
  at: ISODateTime
  actorId: ID
  actorRole: Role
  action: string
  entity: string
  entityId?: ID
  detail?: string
}

// ---------- Auth ----------
export interface Credential {
  key: string // `${role}:${mobile}`
  role: Role
  userId: ID
  mpinHash: string | null
  salt: string
  createdAt: ISODateTime
  lastLoginAt?: ISODateTime
}

// ---------- Licence console (Super Administrator) ----------
export type MasterKind = 'subscription_type' | 'company' | 'language' | 'product_type' | 'payment_mode' | 'area'

export const MASTER_META: Record<MasterKind, { label: string; plural: string; kicker: string; description: string; nameLabel: string }> = {
  subscription_type: { label: 'Subscription Type', plural: 'Subscription Type', kicker: 'Agent Console', description: 'The billing cycles an agency can sell — daily, weekly, fortnightly, monthly, yearly.', nameLabel: 'Subscription' },
  company: { label: 'Company', plural: 'Companies', kicker: 'Masters', description: 'Publishing houses whose titles are distributed through the network.', nameLabel: 'Company name' },
  language: { label: 'Language', plural: 'Language', kicker: 'Agent Console', description: 'Publication languages offered when adding a product.', nameLabel: 'Language' },
  product_type: { label: 'Product Type', plural: 'Product Type', kicker: 'Agent Console', description: 'Classes of publication — newspapers, magazines, commercial titles.', nameLabel: 'Product type' },
  payment_mode: { label: 'Mode of Pay', plural: 'Mode of Pay', kicker: 'Agent Console', description: 'Ways an agency can remit money or record a settlement.', nameLabel: 'Mode of pay' },
  area: { label: 'Area Master', plural: 'Area Masters', kicker: 'Agent Console', description: 'Areas agencies can serve.', nameLabel: 'Area name' },
}

/** One row of any master list. Optional fields are used by the kinds that need them. */
export interface Master {
  id: ID
  /** Set for an agency's own entries; unset = shared master from the super administrator. */
  ownerId?: ID
  kind: MasterKind
  name: string
  code?: string
  description?: string
  shortName?: string
  address?: string
  website?: string
  status: AccountStatus
}

/** A new agency asking for an account — decided on the Account Verification screen. */
export interface AccountRequest {
  id: ID
  accountNo: string
  agencyName: string
  ownerName: string
  mobile: string
  email: string
  /** Country / State / District / City as entered. */
  location: string
  /** One-time code shown to the administrator so the agency can be called back and confirmed. */
  otp: string
  createdAt: ISODateTime
  status: 'pending' | 'accepted' | 'rejected'
  decidedAt?: ISODateTime
  agentId?: ID
}

/** Licence terms of one distribution agency account. */
export interface Licence {
  agentId: ID
  accountNo: string
  planId: ID | null
  registeredOn: ISODate
  verifiedOn: ISODate
  licenceEnd: ISODate
  /** Staff logins (agent + executives) the licence allows. */
  userLimit: number
  locked: boolean
  renewalRequested?: boolean
  lastLoginAt?: ISODateTime
  lastIp?: string
}

export interface Broadcast {
  id: ID
  /** Agent ids. */
  accountIds: ID[]
  startDate: ISODate
  expiryDate: ISODate
  message: string
  kind: 'notification' | 'alert'
  createdAt: ISODateTime
  createdBy: ID
}

export interface Reseller {
  id: ID
  accountNo: string
  name: string
  mobile: string
  email: string
  address: string
  status: AccountStatus
}

export interface LicencePlan {
  id: ID
  name: string
  rate: number
  gstPct: number
  netAmount: number
  renewalAmount: number
  totalRenewal: number
  logo?: string
  primary: boolean
}

/** Handling Charge Setting: the default monthly handling charge of one agency. */
export interface HandlingCharge {
  id: ID
  agentId: ID
  /** yyyy-MM */
  month: string
  amount: number
}

export type RollAction = 'view' | 'add' | 'edit' | 'delete'
/** User Roll: which menu pages a staff user may open and what they may do there. */
export interface UserRoll {
  id: ID
  agentId: ID
  name: string
  description: string
  status: AccountStatus
  /** Menu path to the actions allowed on it. */
  perms: Record<string, RollAction[]>
}
export interface StaffUser {
  id: ID
  agentId: ID
  rollId: ID
  /** "User Name" of the legacy User form. */
  name: string
  extension?: string
  description: string
  status: AccountStatus
}

export interface SystemSettings {
  agencyName: string
  agencyAddress: string
  gstin: string
  supportPhone: string
  invoicePrefix: string
  receiptPrefix: string
  billingDueDays: number
  adminMaxDiscountPct: number
  defaultAgentMaxDiscountPct: number
  agentPriceMaxMarkupPct: number // agent-specific customer price may deviate ±x% from base
  lowStockDefault: number
  overdueAfterDays: number
}
