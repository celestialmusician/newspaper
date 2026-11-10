import type {
  AccountRequest,
  ActivityLog,
  Admin,
  Agent,
  AppNotification,
  Broadcast,
  Complaint,
  Credential,
  HandlingCharge,
  Customer,
  DeliveryRecord,
  Discount,
  Executive,
  Handover,
  Holiday,
  Invoice,
  Licence,
  LicencePlan,
  LocationNode,
  Master,
  Payment,
  PriceVersion,
  Product,
  Remittance,
  Reseller,
  Route,
  StockEntry,
  Subscription,
  StaffUser,
  SubscriptionEvent,
  SystemSettings,
  UserRoll,
} from './types'

/** Whole dataset held by the mock server. Each key maps to one REST resource. */
export interface DB {
  version: number
  seededOn: string
  settings: SystemSettings
  admins: Admin[]
  agents: Agent[]
  executives: Executive[]
  customers: Customer[]
  locations: LocationNode[]
  products: Product[]
  prices: PriceVersion[]
  subscriptions: Subscription[]
  subscriptionEvents: SubscriptionEvent[]
  holidays: Holiday[]
  routes: Route[]
  handovers: Handover[]
  deliveries: Record<string, DeliveryRecord>
  stock: Record<string, StockEntry>
  discounts: Discount[]
  invoices: Invoice[]
  payments: Payment[]
  remittances: Remittance[]
  complaints: Complaint[]
  notifications: AppNotification[]
  logs: ActivityLog[]
  // Licence console (Super Administrator)
  masters: Master[]
  accountRequests: AccountRequest[]
  licences: Licence[]
  broadcasts: Broadcast[]
  resellers: Reseller[]
  licencePlans: LicencePlan[]
  // Agency back office
  handlingCharges: HandlingCharge[]
  userRolls: UserRoll[]
  staffUsers: StaffUser[]
  credentials: Record<string, Credential>
  /** Idempotency keys already applied — guards offline replay & double-submit. */
  processedKeys: Record<string, string>
  counters: Record<string, number>
  /** http mode, before sign-in: headline counts for the sign-in screen. */
  publicCounts?: { subscribers: number; routes: number; publications: number }
}

export const DB_VERSION = 8
