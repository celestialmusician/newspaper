import { addMonths } from 'date-fns'
import { addDaysISO, eachDay, fromISO, monthEndISO, monthStartISO, toISO, todayISO } from '@/lib/dates'
import { round2 } from '@/lib/utils'
import { allocatePayment, draftInvoice, invoiceStatus } from '@/domain/billing'
import { DB_VERSION, type DB } from '@/domain/db'
import { deriveSubscriptionStatus, occurrences, demandByProduct } from '@/domain/schedule'
import type {
  AccountRequest,
  Agent,
  Broadcast,
  Customer,
  Executive,
  Frequency,
  Holiday,
  ID,
  Invoice,
  Licence,
  LicencePlan,
  LocationNode,
  Master,
  Payment,
  PaymentMethod,
  PriceVersion,
  Product,
  Reseller,
  Route,
  Subscription,
} from '@/domain/types'

/** Deterministic PRNG so every fresh demo has the same story. */
function rng(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const monthsFrom = (iso: string, n: number) => toISO(addMonths(fromISO(iso), n))

export function buildSeed(): DB {
  const r = rng(20261103)
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!
  const today = todayISO()
  const now = new Date().toISOString()
  const billingStart = monthStartISO(monthsFrom(today, -2)) // two full billed months
  const lastMonthStart = monthStartISO(monthsFrom(today, -1))
  const nextMonthStart = monthStartISO(monthsFrom(today, 1))
  const ADMIN = 'adm_1'

  // ---------------- Locations ----------------
  const L: LocationNode[] = []
  const loc = (id: string, level: LocationNode['level'], name: string, parentId: string | null, extra: Partial<LocationNode> = {}) => {
    L.push({ id, level, name, parentId, ...extra })
    return id
  }
  loc('in', 'country', 'India', null)
  loc('kl', 'state', 'Kerala', 'in')
  loc('tn', 'state', 'Tamil Nadu', 'in')
  loc('d_tvm', 'district', 'Thiruvananthapuram', 'kl')
  loc('d_klm', 'district', 'Kollam', 'kl')
  loc('d_ekm', 'district', 'Ernakulam', 'kl')
  loc('d_ktm', 'district', 'Kottayam', 'kl')
  loc('d_kkd', 'district', 'Kozhikode', 'kl')
  loc('d_chn', 'district', 'Chennai', 'tn')
  loc('c_tvm', 'city', 'Thiruvananthapuram', 'd_tvm')
  loc('c_atl', 'city', 'Attingal', 'd_tvm')
  loc('c_klm', 'city', 'Kollam', 'd_klm')
  loc('c_koc', 'city', 'Kochi', 'd_ekm')
  loc('c_ktm', 'city', 'Kottayam', 'd_ktm')
  loc('c_kkd', 'city', 'Kozhikode', 'd_kkd')
  loc('c_chn', 'city', 'Chennai', 'd_chn')
  loc('lc_mc', 'locality', 'Medical College', 'c_tvm')
  loc('lc_ptm', 'locality', 'Pattom', 'c_tvm')
  loc('lc_skr', 'locality', 'Sreekariyam', 'c_tvm')
  loc('lc_prk', 'locality', 'Peroorkada', 'c_tvm')
  loc('lc_ply', 'locality', 'Palayam', 'c_tvm')
  loc('lc_atl', 'locality', 'Attingal Town', 'c_atl')
  loc('lc_klm', 'locality', 'Chinnakada', 'c_klm')
  loc('lc_koc', 'locality', 'Edappally', 'c_koc')
  loc('lc_ktm', 'locality', 'Nagampadam', 'c_ktm')
  loc('lc_kkd', 'locality', 'Nadakkavu', 'c_kkd')
  loc('lc_chn', 'locality', 'T. Nagar', 'c_chn')
  const area = (id: string, name: string, parent: string, pincode: string, lat: number, lng: number) => loc(id, 'area', name, parent, { pincode, lat, lng })
  area('a_kmp', 'Kumarapuram', 'lc_mc', '695011', 8.5163, 76.9318)
  area('a_mc', 'Medical College', 'lc_mc', '695011', 8.5232, 76.9275)
  area('a_ulr', 'Ulloor', 'lc_mc', '695011', 8.5339, 76.9286)
  area('a_ptm', 'Pattom', 'lc_ptm', '695004', 8.5204, 76.9418)
  area('a_kvd', 'Kesavadasapuram', 'lc_ptm', '695004', 8.5285, 76.9369)
  area('a_kwd', 'Kowdiar', 'lc_ptm', '695003', 8.5231, 76.9571)
  area('a_ply', 'Palayam', 'lc_ply', '695034', 8.5031, 76.9512)
  area('a_skr', 'Sreekariyam', 'lc_skr', '695017', 8.5478, 76.9167)
  area('a_kzk', 'Kazhakkoottam', 'lc_skr', '695582', 8.5686, 76.8731)
  area('a_prk', 'Peroorkada', 'lc_prk', '695005', 8.5337, 76.9668)
  area('a_vtk', 'Vattiyoorkavu', 'lc_prk', '695013', 8.5295, 76.9887)
  area('a_atl', 'Attingal', 'lc_atl', '695101', 8.6962, 76.8151)
  area('a_klm', 'Chinnakada', 'lc_klm', '691001', 8.8881, 76.5953)
  area('a_koc', 'Edappally', 'lc_koc', '682024', 10.0261, 76.3083)
  area('a_ktm', 'Nagampadam', 'lc_ktm', '686001', 9.5916, 76.5288)
  area('a_kkd', 'Nadakkavu', 'lc_kkd', '673011', 11.2697, 75.7804)
  area('a_chn', 'T. Nagar', 'lc_chn', '600017', 13.0418, 80.2341)
  const areaById = new Map(L.map((l) => [l.id, l]))

  // ---------------- People ----------------
  const agentsSpec: [string, string, string[]][] = [
    ['Rajesh Kumar', 'Rajesh News Agency', ['a_kmp', 'a_mc', 'a_ulr']],
    ['Suresh Babu', 'Suresh Paper Mart', ['a_ptm', 'a_kvd', 'a_kwd', 'a_ply']],
    ['Pradeep Nair', 'Pradeep Distributors', ['a_skr', 'a_kzk']],
    ['Manoj Kumar', 'Manoj News Point', ['a_prk', 'a_vtk']],
    ['Santhosh Menon', 'Santhosh Agencies', ['a_atl']],
  ]
  const agents: Agent[] = agentsSpec.map(([name, agencyName, areaIds], i) => ({
    id: `agt_${i + 1}`,
    code: `AG-${String(i + 1).padStart(2, '0')}`,
    name,
    mobile: `99999${String((i % 9) + 1).repeat(5)}`, // dummy: 9999911111, 9999922222, ...
    email: `${name.split(' ')[0]!.toLowerCase()}@morningtalk.in`,
    agencyName,
    areaIds,
    maxDiscountPct: i === 0 ? 15 : 10,
    canManageRoutes: i !== 4,
    joiningDate: `202${i % 2 ? 3 : 2}-0${(i % 8) + 1}-1${i}`,
    status: 'active',
  }))

  const execSpec: [string, number, string[]][] = [
    ['Akhil S', 0, ['a_kmp', 'a_mc']],
    ['Vishnu Raj', 0, ['a_ulr']],
    ['Anoop Kumar', 1, ['a_ptm', 'a_kvd']],
    ['Rahul S', 1, ['a_kwd', 'a_ply']],
    ['Shyam Mohan', 2, ['a_skr', 'a_kzk']],
    ['Jithin Thomas', 3, ['a_prk', 'a_vtk']],
    ['Arjun Das', 1, ['a_kwd']],
    ['Sanoop K', 4, ['a_atl']],
  ]
  const executives: Executive[] = execSpec.map(([name, ai, areaIds], i) => ({
    id: `exe_${i + 1}`,
    code: `DE-${String(i + 1).padStart(2, '0')}`,
    name,
    mobile: `88888${String((i % 9) + 1).repeat(5)}`, // dummy: 8888811111, 8888822222, ...
    agentId: agents[ai]!.id,
    areaIds,
    joiningDate: i === 3 ? addDaysISO(today, -24) : `2024-0${(i % 9) + 1}-0${(i % 8) + 1}`,
    status: 'active',
    canCollectCash: i !== 6,
    altMobile: `77777${String((i % 9) + 1).repeat(5)}`,
    altMobileRelation: (['Father', 'Spouse', 'Brother', 'Mother', 'Spouse', 'Sister', 'Father'] as const)[i % 7],
  }))

  // ---------------- Products & prices ----------------
  type PSpec = [string, string, Product['category'], string, string, Product['type'], Frequency, string, [number, number, number], string]
  const productSpec: PSpec[] = [
    ['MM', 'Malayala Manorama', 'Malayalam Newspapers', 'Malayala Manorama Co. Ltd', 'Malayalam', 'Newspaper', 'daily', '#b91c1c', [6, 8, 10], 'Kerala\'s largest-circulated Malayalam daily.'],
    ['MB', 'Mathrubhumi', 'Malayalam Newspapers', 'The Mathrubhumi Printing & Publishing Co.', 'Malayalam', 'Newspaper', 'daily', '#1d4ed8', [6, 8, 10], 'Malayalam daily with statewide editions.'],
    ['DB', 'Deshabhimani', 'Malayalam Newspapers', 'Deshabhimani Publications', 'Malayalam', 'Newspaper', 'daily', '#dc2626', [5, 6.5, 8], 'Malayalam daily newspaper.'],
    ['MD', 'Madhyamam', 'Malayalam Newspapers', 'Ideal Publication Trust', 'Malayalam', 'Newspaper', 'daily', '#0f766e', [5, 6.5, 8], 'Malayalam daily newspaper.'],
    ['KK', 'Kerala Kaumudi', 'Regional Newspapers', 'Kerala Kaumudi Ltd', 'Malayalam', 'Newspaper', 'daily', '#7c3aed', [5, 6.5, 8], 'Thiruvananthapuram-based Malayalam daily.'],
    ['TH', 'The Hindu', 'English Newspapers', 'THG Publishing Pvt Ltd', 'English', 'Newspaper', 'daily', '#111827', [7, 9, 12], 'National English daily.'],
    ['NIE', 'The New Indian Express', 'English Newspapers', 'Express Publications (Madurai) Ltd', 'English', 'Newspaper', 'daily', '#2563eb', [6, 8, 10], 'English daily with Kerala editions.'],
    ['VAN', 'Vanitha', 'Fortnightly Magazines', 'Malayala Manorama Co. Ltd', 'Malayalam', 'Magazine', 'fortnightly', '#db2777', [30, 34, 40], 'Malayalam women\'s fortnightly.'],
    ['GL', 'Grihalakshmi', 'Fortnightly Magazines', 'The Mathrubhumi Printing & Publishing Co.', 'Malayalam', 'Magazine', 'fortnightly', '#c026d3', [30, 34, 40], 'Malayalam family fortnightly.'],
    ['BR', 'Balarama', "Children's Magazines", 'Malayala Manorama Co. Ltd', 'Malayalam', 'Magazine', 'weekly', '#ea580c', [18, 21, 25], 'Children\'s weekly with stories and comics.'],
    ['KLK', 'Kalikkudukka', "Children's Magazines", 'Malayala Manorama Co. Ltd', 'Malayalam', 'Magazine', 'weekly', '#16a34a', [15, 18, 22], 'Children\'s weekly for young readers.'],
    ['BB', 'Balabhumi', "Children's Magazines", 'The Mathrubhumi Printing & Publishing Co.', 'Malayalam', 'Magazine', 'weekly', '#0891b2', [14, 17, 20], 'Children\'s weekly.'],
    ['TZV', 'Thozhilveedhi', 'Educational Publications', 'Malayala Manorama Co. Ltd', 'Malayalam', 'Periodical', 'weekly', '#4d7c0f', [10, 12, 15], 'Weekly career and PSC exam guide.'],
    ['SK', 'Shasthrakeralam', 'Monthly Magazines', 'Kerala Sasthra Sahithya Parishad', 'Malayalam', 'Magazine', 'monthly', '#0369a1', [20, 24, 30], 'Monthly science magazine for students.'],
    ['BM', 'Bobanum Moliyum', 'Comics and Story Books', 'Kottayam Pushpanath Publications', 'Malayalam', 'Book', 'every_14_days', '#ca8a04', [16, 19, 25], 'Malayalam comic digest.'],
  ]
  const products: Product[] = productSpec.map(([code, name, category, publisher, language, type, defaultFrequency, color, , description], i) => ({
    id: `prd_${code.toLowerCase()}`,
    code,
    name,
    category,
    publisher,
    language,
    type,
    description,
    availability: 'Available',
    defaultFrequency,
    status: 'active',
    color,
    lowStockThreshold: type === 'Newspaper' ? 2 : 3,
    createdOn: `2025-0${(i % 9) + 1}-01`,
  }))
  const P = (code: string) => `prd_${code.toLowerCase()}`

  const prices: PriceVersion[] = []
  const price = (productId: ID, agentId: ID | null, [purchasePrice, agentPrice, customerPrice]: [number, number, number], effectiveFrom: string, note?: string) =>
    prices.push({ id: `prc_${prices.length + 1}`, productId, agentId, purchasePrice, agentPrice, customerPrice, effectiveFrom, createdBy: ADMIN, createdAt: `${effectiveFrom}T06:00:00.000Z`, note })
  for (const [code, , , , , , , , triple] of productSpec) {
    if (code === 'MM') {
      price(P(code), null, [5.5, 7.5, 9], '2025-01-01', 'Opening price')
      price(P(code), null, triple, lastMonthStart, 'Publisher cover-price revision')
    } else price(P(code), null, triple, '2025-01-01', 'Opening price')
  }
  // Future revision — visible in pricing, used only from next month.
  price(P('TH'), null, [7.5, 9.5, 13], nextMonthStart, 'Announced cover-price increase')
  // Agent-specific price within the ±10% rule (rural transport cost).
  price(P('MB'), agents[4]!.id, [6, 8.3, 10.5], '2025-06-01', 'Attingal transport surcharge')

  // ---------------- Routes & customers ----------------
  const routeSpec: [string, string[], number, number][] = [
    ['Kumarapuram – Medical College', ['a_kmp', 'a_mc'], 0, 0],
    ['Ulloor Junction Loop', ['a_ulr'], 0, 1],
    ['Pattom – Kesavadasapuram', ['a_ptm', 'a_kvd'], 1, 2],
    ['Kowdiar – Palayam', ['a_kwd', 'a_ply'], 1, 3],
    ['Sreekariyam – Kazhakkoottam', ['a_skr', 'a_kzk'], 2, 4],
    ['Peroorkada – Vattiyoorkavu', ['a_prk', 'a_vtk'], 3, 5],
    ['Attingal Town', ['a_atl'], 4, 7],
  ]
  const routes: Route[] = routeSpec.map(([name, areaIds, ai, ei], i) => ({
    id: `rte_${i + 1}`,
    code: `RT-${String(i + 1).padStart(2, '0')}`,
    name,
    areaIds,
    agentId: agents[ai]!.id,
    executiveId: executives[ei]!.id,
    stops: [],
    instructions: i === 0 ? 'Start from Kumarapuram junction after 5:15 AM bundle drop. Medical College staff quarters gate opens at 5:30.' : 'Collect bundle from agency point by 5:00 AM.',
    status: 'active',
    createdOn: '2025-02-01',
  }))

  type SubSpec = [code: string, freq: Frequency, opt?: { wd?: number[]; md?: number[]; qty?: number; custom?: boolean }]
  type CustSpec = [name: string, route: number, area: string, gender: Customer['gender'], house: string, subs: SubSpec[], instructions?: string]
  const custSpec: CustSpec[] = [
    ['Arun Kumar', 0, 'a_kmp', 'Male', 'Sreenilayam, KRA-14', [['MM', 'daily'], ['BR', 'weekly', { wd: [4] }], ['VAN', 'fortnightly']], 'Drop inside the letter box at the gate.'],
    ['Rahul Raj', 0, 'a_kmp', 'Male', 'Krishna Kripa, TC 14/221', [['MB', 'daily'], ['TZV', 'weekly', { wd: [6] }]]],
    ['Anoop S', 0, 'a_mc', 'Male', 'Thekkedathu House', [['TH', 'daily'], ['MM', 'daily']], 'Second floor flat 2B — leave with security.'],
    ['Sreelakshmi Nair', 0, 'a_mc', 'Female', 'Lakshmi Bhavan, MCRA-7', [['MM', 'daily'], ['GL', 'fortnightly'], ['VAN', 'fortnightly']]],
    ['Ramachandran Nair', 0, 'a_kmp', 'Male', 'Gokulam, Kumarapuram Lane 3', [['KK', 'daily'], ['TH', 'twice_weekly', { wd: [0, 3] }]], 'Senior citizen — hand over at the door, ring bell once.'],
    ['Athira Mohan', 1, 'a_ulr', 'Female', 'Athira, Ulloor-Akkulam Road', [['MB', 'daily'], ['KLK', 'weekly', { wd: [2] }]]],
    ['Vishnu Prasad', 1, 'a_ulr', 'Male', 'TC 9/1180, Prasanth Nagar', [['NIE', 'daily'], ['MM', 'daily']]],
    ['Haritha Sunil', 1, 'a_ulr', 'Female', 'Harithas, Ulloor Kesavadev Road', [['MD', 'daily'], ['VAN', 'fortnightly']]],
    ['Jayakrishnan V', 1, 'a_ulr', 'Male', 'Pournami, Cheruvakkal', [['DB', 'daily'], ['VAN', 'fortnightly']]],
    ['Abhijith Menon', 2, 'a_ptm', 'Male', 'Menon Villa, Pattom Palace Road', [['TH', 'daily'], ['TZV', 'weekly', { wd: [6] }], ['SK', 'monthly', { md: [5] }]]],
    ['Anjali Krishna', 2, 'a_kvd', 'Female', 'Anjanam, Kesavadasapuram', [['MM', 'daily'], ['BB', 'weekly', { wd: [5] }], ['BR', 'weekly', { wd: [4] }], ['SK', 'monthly', { md: [5] }]]],
    ['Arjun Menon', 2, 'a_kvd', 'Male', 'Flat 4C, Heera Residency', [['NIE', 'daily']]],
    ['Lakshmi Priya', 2, 'a_ptm', 'Female', 'Priyadarshini, Plamoodu', [['MB', 'daily'], ['GL', 'every_14_days']]],
    ['Nikhil Babu', 3, 'a_kwd', 'Male', 'Babu Stores, Kowdiar Junction', [['MM', 'daily', { qty: 2 }], ['MB', 'daily']], 'Shop opens 6:30 AM — drop on the counter shelf.'],
    ['Keerthana R', 3, 'a_kwd', 'Female', 'Keerthanam, Golf Links Road', [['DB', 'daily'], ['KLK', 'weekly', { wd: [2] }]]],
    ['Sandeep Varghese', 3, 'a_ply', 'Male', 'Varghese House, Palayam', [['TH', 'daily'], ['NIE', 'weekly', { wd: [0] }]]],
    ['Anu Joseph', 3, 'a_ply', 'Female', 'Rose Villa, Nandavanam', [['MM', 'daily'], ['VAN', 'fortnightly']]],
    ['Meera Suresh', 4, 'a_skr', 'Female', 'Meeram, Chavadimukku', [['MM', 'daily'], ['BR', 'weekly', { wd: [4] }]]],
    ['Akhil Raj', 4, 'a_skr', 'Male', 'TC 3/45, Pangappara', [['MB', 'daily']]],
    ['Fathima Rasheed', 4, 'a_kzk', 'Female', 'Rasheed Manzil, Kazhakkoottam', [['MD', 'daily'], ['GL', 'fortnightly']]],
    ['Muhammed Shafi', 4, 'a_kzk', 'Male', 'Shafi Cottage, Technopark Phase 1 Road', [['MD', 'daily'], ['TH', 'daily']]],
    ['Devika Nair', 5, 'a_prk', 'Female', 'Devikripa, Peroorkada', [['MB', 'daily'], ['BB', 'weekly', { wd: [5] }]]],
    ['Sreejith P', 5, 'a_prk', 'Male', 'Puthenveedu, Ambalamukku', [['KK', 'daily'], ['TZV', 'weekly', { wd: [6] }]]],
    ['Revathy Ajith', 5, 'a_vtk', 'Female', 'Revathy, Vattiyoorkavu', [['MM', 'daily'], ['VAN', 'fortnightly'], ['GL', 'fortnightly']]],
    ['Adarsh Pillai', 5, 'a_vtk', 'Male', 'Pillai House, Kanjirampara', [['NIE', 'daily'], ['MB', 'daily']]],
    ['Amal Thomas', 6, 'a_atl', 'Male', 'Thomas Bhavan, Attingal', [['MM', 'daily'], ['TZV', 'custom', { custom: true }]]],
    ['Gokul Krishnan', 6, 'a_atl', 'Male', 'Gokulam, Avanavanchery', [['MB', 'daily'], ['KLK', 'weekly', { wd: [2] }], ['BM', 'every_14_days']]],
    ['Bindu Sasidharan', 6, 'a_atl', 'Female', 'Bindu Nivas, Mamom', [['DB', 'daily'], ['VAN', 'twice_monthly', { md: [5, 20] }]]],
  ]

  const customers: Customer[] = []
  const subscriptions: Subscription[] = []
  const subStart = monthsFrom(billingStart, -4)
  // Dummy numbers that look obviously fake: 6666600001, 6666600002, ... (alternates: 6666700001, ...).
  // The two draws below are kept so the rest of the seeded random data stays exactly as it was.
  const usedMobiles = new Set<string>()
  const mobileSeq = [0, 0]
  const mobile = (alt = false) => {
    pick(['9', '8', '7'])
    r()
    const m = `${alt ? '66667' : '66666'}${String(++mobileSeq[alt ? 1 : 0]!).padStart(5, '0')}`
    usedMobiles.add(m)
    return m
  }

  custSpec.forEach(([name, ri, areaId, gender, house, subs, instructions], i) => {
    const a = areaById.get(areaId)!
    const route = routes[ri]!
    const id = `cus_${i + 1}`
    const m = mobile()
    const registeredOn = addDaysISO(subStart, -Math.floor(r() * 200))
    const c: Customer = {
      id,
      code: `MT-C-${String(1001 + i)}`,
      name,
      mobile: m,
      whatsapp: m,
      altMobile: r() > 0.6 ? mobile(true) : undefined,
      email: r() > 0.4 ? `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@gmail.com` : undefined,
      gender,
      dob: r() > 0.5 ? `19${60 + Math.floor(r() * 39)}-0${1 + Math.floor(r() * 9)}-1${Math.floor(r() * 9)}` : undefined,
      areaId,
      houseName: house,
      landmark: pick(['Near temple', 'Opp. bus stop', 'Behind post office', 'Near church', 'Near ration shop', 'Next to bakery']),
      address: `${house}, ${a.name}, ${areaById.get(areaById.get(a.parentId!)!.parentId!)!.name} - ${a.pincode}`,
      lat: round2((a.lat! + (r() - 0.5) * 0.008) * 1e4) / 1e4,
      lng: round2((a.lng! + (r() - 0.5) * 0.008) * 1e4) / 1e4,
      agentId: route.agentId,
      routeId: route.id,
      idProof: pick(['Aadhaar Card', 'Voter ID', 'Driving Licence', 'None'] as const),
      securityDeposit: pick([0, 0, 100, 200]),
      handlingCharge: name === 'Nikhil Babu' ? 20 : pick([0, 0, 0, 10]),
      status: 'active',
      registeredOn,
    }
    if (c.idProof !== 'None') c.idNumber = `XXXX-XXXX-${1000 + Math.floor(r() * 8999)}`
    customers.push(c)
    route.stops.push({ customerId: id, instructions })
    subs.forEach(([code, frequency, opt], j) => {
      const prod = products.find((p) => p.code === code)!
      const start = addDaysISO(subStart, Math.floor(r() * 20))
      const s: Subscription = {
        id: `sub_${i + 1}_${j + 1}`,
        customerId: id,
        productId: prod.id,
        startDate: frequency === 'every_14_days' ? addDaysISO(billingStart, -14 * 3 + j) : start,
        endDate: null,
        frequency,
        weekdays: opt?.wd ?? [],
        monthDays: opt?.md ?? [],
        customDates: opt?.custom ? eachDay(billingStart, monthEndISO(nextMonthStart)).filter((_, k) => k % 9 === 3) : [],
        quantity: opt?.qty ?? 1,
        status: 'active',
        pauses: [],
        createdOn: start,
      }
      subscriptions.push(s)
    })
  })
  const sub = (cust: number, n: number) => subscriptions.find((s) => s.id === `sub_${cust}_${n}`)!
  // Story beats -------------------------------------------------
  sub(17, 1).pauses.push({ from: addDaysISO(today, -3), to: addDaysISO(today, 7), reason: 'Family trip to Bengaluru' }) // Anu Joseph — paused now
  sub(17, 2).pauses.push({ from: addDaysISO(today, -3), to: addDaysISO(today, 7), reason: 'Family trip to Bengaluru' })
  sub(8, 1).pauses.push({ from: addDaysISO(lastMonthStart, 9), to: addDaysISO(lastMonthStart, 18), reason: 'Out of station' }) // Haritha — past pause
  sub(9, 2).endDate = monthEndISO(billingStart) // Jayakrishnan — Vanitha expired
  const adarshNie = sub(25, 1)
  adarshNie.cancelledOn = addDaysISO(today, -10) // switched to Mathrubhumi
  sub(25, 2).startDate = addDaysISO(today, -10)
  sub(25, 2).createdOn = addDaysISO(today, -10)
  for (const s of subscriptions) s.status = deriveSubscriptionStatus(s, today)

  // ---------------- Holidays ----------------
  const holidays: Holiday[] = [
    { id: 'hol_1', name: 'Thiruvonam – Newspaper Holiday', date: '2026-08-27', type: 'Newspaper Holiday', locationIds: ['kl'], productIds: [], deliveryApplicable: false, description: 'No newspapers printed the day after Thiruvonam.' },
    { id: 'hol_2', name: 'Gandhi Jayanti', date: '2026-10-02', type: 'Public Holiday', locationIds: [], productIds: [], deliveryApplicable: true, description: 'Public holiday — delivery continues as usual.' },
    { id: 'hol_3', name: 'Mahanavami – Newspaper Holiday', date: addDaysISO(lastMonthStart, 19), type: 'Newspaper Holiday', locationIds: ['kl'], productIds: [], deliveryApplicable: false, description: 'Publishers closed for Pooja holidays.' },
    { id: 'hol_4', name: 'Thiruvananthapuram District Hartal', date: addDaysISO(lastMonthStart, 13), type: 'Strike / Hartal', locationIds: ['d_tvm'], productIds: [], deliveryApplicable: false, description: 'Dawn-to-dusk hartal. Distribution suspended in the district.' },
    { id: 'hol_5', name: 'Kerala Piravi', date: `${today.slice(0, 4)}-11-01`, type: 'Public Holiday', locationIds: ['kl'], productIds: [], deliveryApplicable: true, description: 'State formation day — newspapers delivered.' },
    { id: 'hol_6', name: 'Sreekariyam Road Blockade', date: addDaysISO(today, 9), type: 'Regional Holiday', locationIds: ['a_skr', 'a_kzk'], productIds: [], deliveryApplicable: false, description: 'Local strike announced by traders\' association.' },
    { id: 'hol_7', name: 'Christmas – Newspaper Holiday', date: `${today.slice(0, 4)}-12-26`, type: 'Newspaper Holiday', locationIds: ['kl'], productIds: [], deliveryApplicable: false, description: 'No newspapers on 26 December.' },
    { id: 'hol_8', name: 'Attingal Temple Festival', date: addDaysISO(today, 4), type: 'Special Holiday', locationIds: ['c_atl'], productIds: [P('TZV')], deliveryApplicable: false, description: 'Thozhilveedhi delivery shifted for festival traffic.' },
  ]

  // ---------------- Licence console ----------------
  let mid = 0
  const master = (kind: Master['kind'], name: string, extra: Partial<Master> = {}): Master => ({ id: `mst_${++mid}`, kind, name, status: 'active', ...extra })
  const masters: Master[] = [
    ...[
      ['Daily', ''],
      ['Weekly', ''],
      ['Fortnight', 'Monthly 2 issues'],
      ['Fortnightly', 'Every 14 days'],
      ['Monthly', ''],
      ['Yearly', ''],
    ].map(([n, d]) => master('subscription_type', n!, { description: d })),
    ...['Tamil Publications', 'Malayalam Publications', 'English Publications', 'Labour India Publications (M, E, CBSC)', "Students India Publications (M, E, CBSC)", 'Hindi Publications', 'General'].map((n) => master('company', n, { shortName: n.split(' ')[0]!.slice(0, 4).toUpperCase() })),
    ...['Assamese', 'Bengali', 'English', 'Gujarati', 'Hindi', 'Kannada', 'Kashmiri', 'Malayalam', 'Marathi', 'Odia', 'Punjabi', 'Tamil', 'Telugu', 'Urdu'].map((n) => master('language', n)),
    ...['Newspaper', 'Magazine', 'Periodical', 'Book', 'Commercial'].map((n) => master('product_type', n, { code: n.slice(0, 3).toUpperCase() })),
    ...['Account', 'NEFT', 'CRED', 'Paytm', 'PhonePe', 'GPay', 'Cash'].map((n) => master('payment_mode', n)),
    ...['Ernakulam', 'Trivandrum'].map((n) => master('area', n)),
  ]
  // Each agency keeps its own subscription types and payment modes (the legacy panel did the same).
  for (const a of agents) {
    for (const n of ['Daily', 'Weekly', 'Fortnight', 'Fortnightly', 'Monthly', 'Yearly']) masters.push({ id: `mst_${a.id}_${n}`, ownerId: a.id, kind: 'subscription_type', name: n, status: 'active' })
    for (const n of ['Cash', 'UPI', 'NEFT', 'GPay', 'PhonePe', 'Paytm']) masters.push({ id: `mst_${a.id}_pm_${n}`, ownerId: a.id, kind: 'payment_mode', name: n, status: 'active' })
  }
  const handlingCharges = agents.map((a, i) => ({ id: `hch_${i + 1}`, agentId: a.id, month: today.slice(0, 7), amount: 30 }))
  const rollMenus = ['/', '/manage-route', '/delivery-boys', '/customers-master', '/manage-subscriptions', '/payment-collection', '/bill-adjustment', '/bill']
  const userRolls = agents.slice(0, 2).flatMap((a, i) => [
    { id: `rol_${i * 2 + 1}`, agentId: a.id, name: 'BILL AMOUNT COLLECTING', description: 'Collects payments against bills', status: 'active' as const, perms: { '/': ['view' as const], '/payment-collection': ['view' as const, 'add' as const], '/bill': ['view' as const] } },
    { id: `rol_${i * 2 + 2}`, agentId: a.id, name: 'ROUTE MANAGING', description: 'Maintains routes, delivery boys and customers', status: 'active' as const, perms: Object.fromEntries(rollMenus.map((m) => [m, ['view' as const, 'add' as const, 'edit' as const]])) },
  ])
  const staffUsers = [{ id: 'stf_1', agentId: agents[0]!.id, rollId: 'rol_1', name: 'counter', extension: '101', description: 'Front desk', status: 'active' as const }]
  const licencePlans: LicencePlan[] = [
    { id: 'lpl_1', name: 'NewsRound Subscription 6M', rate: 1200, gstPct: 18, netAmount: 1416, renewalAmount: 1000, totalRenewal: 1180, primary: false },
    { id: 'lpl_2', name: 'NewsRound Subscription 12M', rate: 2000, gstPct: 18, netAmount: 2360, renewalAmount: 1800, totalRenewal: 2124, primary: true },
  ]
  const licenceEnds = [214, 26, 335, 9, -12]
  const lastSeenHours = [0.3, 48, 216, 990, null]
  const licences: Licence[] = agents.map((a, i) => ({
    agentId: a.id,
    accountNo: `${String(i + 1).padStart(3, '0')}-${a.joiningDate.slice(5, 7)}${a.joiningDate.slice(2, 4)}/D`,
    planId: i < 2 ? 'lpl_1' : 'lpl_2',
    registeredOn: a.joiningDate,
    verifiedOn: a.joiningDate,
    licenceEnd: addDaysISO(today, licenceEnds[i]!),
    userLimit: 3 + (i % 3),
    locked: false,
    renewalRequested: i === 3,
    lastLoginAt: lastSeenHours[i] == null ? undefined : new Date(Date.now() - lastSeenHours[i]! * 3600e3).toISOString(),
    lastIp: lastSeenHours[i] == null ? undefined : i % 2 ? '2001:db8::1' : '2001:db8::2',
  }))
  // Agencies register straight into an account now (no manual approval), so there are no pending requests.
  const accountRequests: AccountRequest[] = []
  const broadcasts: Broadcast[] = [
    { id: 'bcs_1', accountIds: agents.map((a) => a.id), startDate: addDaysISO(today, -4), expiryDate: addDaysISO(today, 10), message: 'Price revision: The Hindu moves to ₹13 per copy from next month. Please inform your subscribers.', kind: 'notification', createdAt: new Date(Date.now() - 4 * 24 * 3600e3).toISOString(), createdBy: ADMIN },
    { id: 'bcs_2', accountIds: [agents[3]!.id, agents[4]!.id], startDate: addDaysISO(today, -1), expiryDate: addDaysISO(today, 14), message: 'Your licence is due for renewal. Please renew to keep your account active.', kind: 'alert', createdAt: new Date(Date.now() - 24 * 3600e3).toISOString(), createdBy: ADMIN },
  ]
  const resellers: Reseller[] = [
    { id: 'rsl_1', accountNo: 'RS-001', name: 'Joseph Mathew', mobile: '9111111111', email: 'joseph@keralamedia.in', address: 'Kerala Media Partners, Statue Road, Thiruvananthapuram', status: 'active' },
    { id: 'rsl_2', accountNo: 'RS-002', name: 'Lakshmi Menon', mobile: '9222222222', email: 'lakshmi.distributors@gmail.com', address: 'Lakshmi Distributors, MG Road, Kochi', status: 'active' },
  ]

  const db: DB = {
    version: DB_VERSION,
    seededOn: now,
    settings: {
      agencyName: 'Morning Talk News Agency',
      agencyAddress: 'TC 25/1430, Statue Road, Thiruvananthapuram, Kerala 695001',
      gstin: '32ABCDE1234F1Z5',
      supportPhone: '9999900000',
      invoicePrefix: 'MTN',
      receiptPrefix: 'RCP',
      billingDueDays: 10,
      adminMaxDiscountPct: 50,
      defaultAgentMaxDiscountPct: 10,
      agentPriceMaxMarkupPct: 10,
      lowStockDefault: 3,
      overdueAfterDays: 10,
    },
    admins: [{ id: ADMIN, name: 'Harikrishnan Nair', mobile: '9999999999', email: 'admin@morningtalk.in', status: 'active' }],
    agents,
    executives,
    customers,
    locations: L,
    products,
    prices,
    subscriptions,
    subscriptionEvents: subscriptions.map((s, i) => ({ id: `sev_${i + 1}`, subscriptionId: s.id, at: `${s.createdOn}T09:00:00.000Z`, by: customers.find((c) => c.id === s.customerId)!.agentId, action: 'created', detail: 'Subscription registered' })),
    holidays,
    routes,
    handovers: [{ id: 'hnd_1', routeId: 'rte_4', fromExecutiveId: 'exe_7', toExecutiveId: 'exe_4', at: `${addDaysISO(today, -24)}T05:00:00.000Z`, by: 'agt_2', note: 'Arjun Das moved to Kowdiar relief duty; Rahul S takes over permanently.' }],
    deliveries: {},
    stock: {},
    discounts: [
      { id: 'dsc_1', customerId: 'cus_5', subscriptionId: null, kind: 'percentage', category: 'Customer-Specific', value: 10, startDate: '2025-01-01', expiryDate: null, reason: 'Senior citizen concession', approvedBy: ADMIN, createdAt: '2025-01-01T09:00:00.000Z' },
      { id: 'dsc_2', customerId: 'cus_1', subscriptionId: null, kind: 'fixed', category: 'Promotional', value: 30, startDate: billingStart, expiryDate: monthEndISO(addDaysISO(nextMonthStart, -1)), reason: 'Referral reward — 3 neighbours joined', approvedBy: 'agt_1', createdAt: `${billingStart}T09:00:00.000Z` },
      { id: 'dsc_3', customerId: 'cus_18', subscriptionId: 'sub_18_1', kind: 'percentage', category: 'Long-Term Subscription', value: 5, startDate: '2025-01-01', expiryDate: null, reason: '5+ years continuous subscriber', approvedBy: ADMIN, createdAt: '2025-01-01T09:00:00.000Z' },
      { id: 'dsc_4', customerId: 'cus_14', subscriptionId: 'sub_14_1', kind: 'fixed', category: 'Subscription', value: 40, startDate: billingStart, expiryDate: null, reason: 'Bulk copies for shop', approvedBy: 'agt_2', createdAt: `${billingStart}T09:00:00.000Z` },
    ],
    invoices: [],
    payments: [],
    remittances: [],
    complaints: [],
    notifications: [],
    logs: [],
    masters,
    accountRequests,
    licences,
    broadcasts,
    resellers,
    licencePlans,
    handlingCharges,
    userRolls,
    staffUsers,
    credentials: {},
    processedKeys: {},
    counters: { invoice: 0, receipt: 0, customer: customers.length, complaint: 0, agent: agents.length, executive: executives.length, route: routes.length, reseller: resellers.length, licence: agents.length },
  }

  // ---------------- Delivery history ----------------
  const execAt = (route: Route, date: string) => (route.id === 'rte_4' && date < addDaysISO(today, -24) ? 'exe_7' : route.executiveId)
  const routeOf = new Map(customers.map((c) => [c.id, routes.find((rt) => rt.id === c.routeId)!]))
  const hist = occurrences(db, subscriptions, billingStart, today)
  // Morning round half done: first half of every route's sequence is already delivered today.
  const doneToday = new Set(routes.flatMap((rt) => rt.stops.slice(0, Math.ceil(rt.stops.length / 2)).map((s) => s.customerId)))
  for (const o of hist) {
    if (o.status !== 'pending') continue
    if (o.date === today && !doneToday.has(o.customerId)) continue
    const route = routeOf.get(o.customerId)!
    const missed = r() < 0.035
    const ex = execAt(route, o.date)
    db.deliveries[o.key] = {
      key: o.key,
      subscriptionId: o.subscription.id,
      customerId: o.customerId,
      productId: o.productId,
      date: o.date,
      status: missed ? 'missed' : 'delivered',
      quantity: o.quantity,
      executiveId: ex,
      actualAt: missed ? null : `${o.date}T0${5 + Math.floor(r() * 2)}:${String(10 + Math.floor(r() * 49))}:00+05:30`,
      updatedBy: ex ?? ADMIN,
      updatedAt: `${o.date}T07:30:00+05:30`,
      reason: missed ? pick(['Customer not available', 'House locked', 'Heavy rain', 'Stock shortage']) : undefined,
    }
  }

  // ---------------- Invoices & payments ----------------
  const nextInvoiceNo = (period: string) => `${db.settings.invoicePrefix}-${period.slice(0, 7).replace('-', '')}-${String(++db.counters.invoice).padStart(4, '0')}`
  const nextReceipt = () => `${db.settings.receiptPrefix}-${String(++db.counters.receipt).padStart(5, '0')}`
  const issue = (from: string) => {
    const to = monthEndISO(from)
    const issuedOn = addDaysISO(to, 1)
    for (const c of customers) {
      const d = draftInvoice(db, c.id, from, to)
      if (!d.lines.length) continue
      const inv: Invoice = {
        id: `inv_${db.counters.invoice + 1}`,
        number: nextInvoiceNo(from),
        customerId: c.id,
        agentId: c.agentId,
        periodStart: from,
        periodEnd: to,
        issuedOn,
        dueDate: addDaysISO(issuedOn, db.settings.billingDueDays),
        lines: d.lines,
        subtotal: d.subtotal,
        discount: d.discount,
        handlingCharge: d.handlingCharge,
        adjustments: [],
        currentBill: d.currentBill,
        previousBalance: d.previousBalance,
        paid: 0,
        status: 'unpaid',
      }
      db.invoices.push(inv)
    }
  }
  const pay = (customerId: ID, amount: number, date: string, method: PaymentMethod) => {
    amount = round2(amount)
    if (amount <= 0) return
    const c = customers.find((x) => x.id === customerId)!
    const allocations = allocatePayment(db, customerId, amount)
    for (const a of allocations) {
      const inv = db.invoices.find((i) => i.id === a.invoiceId)!
      inv.paid = round2(inv.paid + a.amount)
      inv.status = invoiceStatus(inv.currentBill, inv.paid)
    }
    const online = method === 'UPI' || method === 'Debit Card' || method === 'Credit Card'
    const route = routeOf.get(customerId)!
    const p: Payment = {
      id: `pay_${db.payments.length + 1}`,
      receiptNo: nextReceipt(),
      customerId,
      agentId: c.agentId,
      amount,
      method,
      date,
      at: `${date}T10:${String(10 + Math.floor(r() * 49))}:00+05:30`,
      collectedBy: online ? customerId : method === 'Delivery Executive Collection' ? route.executiveId! : c.agentId,
      allocations,
      gatewayRef: online ? `SIM-${method === 'UPI' ? 'UPI' : 'CARD'}-${Math.floor(1e7 + r() * 9e7)}` : undefined,
      simulated: online,
      verified: true,
      idempotencyKey: `seed-${db.payments.length + 1}`,
    }
    db.payments.push(p)
  }
  const methods: PaymentMethod[] = ['UPI', 'UPI', 'Cash', 'Delivery Executive Collection', 'Agent Collection', 'Debit Card']
  issue(billingStart)
  const firstIssue = addDaysISO(monthEndISO(billingStart), 1)
  for (const c of customers) {
    const out = db.invoices.filter((i) => i.customerId === c.id).reduce((a, i) => a + i.currentBill - i.paid, 0)
    if (out <= 0) continue
    const roll = r()
    if (roll < 0.78) pay(c.id, out, addDaysISO(firstIssue, 2 + Math.floor(r() * 9)), pick(methods))
    else if (roll < 0.92) pay(c.id, Math.round(out * 0.6), addDaysISO(firstIssue, 5 + Math.floor(r() * 9)), pick(methods))
  }
  issue(lastMonthStart)
  const secondIssue = addDaysISO(monthEndISO(lastMonthStart), 1)
  const daysSinceIssue = Math.max(0, Math.floor((fromISO(today).getTime() - fromISO(secondIssue).getTime()) / 864e5))
  // Example dues used on the delivery executive's collection list.
  const targetDue: Record<string, number> = { cus_1: 350, cus_2: 200, cus_3: 450, cus_4: 150 }
  for (const c of customers) {
    const out = round2(db.invoices.filter((i) => i.customerId === c.id).reduce((a, i) => a + i.currentBill - i.paid, 0))
    if (out <= 0) continue
    const date = addDaysISO(secondIssue, Math.min(daysSinceIssue, 1 + Math.floor(r() * Math.max(1, daysSinceIssue))))
    if (targetDue[c.id] !== undefined) {
      if (out > targetDue[c.id]!) pay(c.id, out - targetDue[c.id]!, date, pick(methods))
      continue
    }
    const roll = r()
    if (roll < 0.45) pay(c.id, out, date, pick(methods))
    else if (roll < 0.6) pay(c.id, Math.round(out / 2), date, pick(methods))
  }
  // Agent remittances to agency (agent-price value).
  agents.forEach((a, i) => {
    const sep = db.invoices.filter((inv) => inv.agentId === a.id && inv.periodStart === billingStart).flatMap((inv) => inv.lines)
    const value = round2(sep.reduce((s, l) => s + l.quantity * l.agentPrice, 0))
    db.remittances.push({ id: `rem_${i * 2 + 1}`, agentId: a.id, amount: value, date: addDaysISO(firstIssue, 12), reference: `NEFT-${84210 + i}`, recordedBy: ADMIN })
    const oct = db.invoices.filter((inv) => inv.agentId === a.id && inv.periodStart === lastMonthStart).flatMap((inv) => inv.lines)
    const v2 = round2(oct.reduce((s, l) => s + l.quantity * l.agentPrice, 0) * (i === 2 ? 0.3 : 0.6))
    db.remittances.push({ id: `rem_${i * 2 + 2}`, agentId: a.id, amount: v2, date: addDaysISO(secondIssue, 1), reference: `UPI-${77310 + i}`, recordedBy: ADMIN })
  })

  // ---------------- Stock ledger (last 14 days + today) ----------------
  for (const a of agents) {
    const subsOfAgent = subscriptions.filter((s) => customers.find((c) => c.id === s.customerId)!.agentId === a.id)
    const carry = new Map<ID, number>()
    for (const date of eachDay(addDaysISO(today, -14), today)) {
      const demand = demandByProduct(db, subsOfAgent, date)
      for (const [productId, qty] of demand) {
        const prod = products.find((p) => p.id === productId)!
        const delivered = Object.values(db.deliveries).filter((d) => d.date === date && d.productId === productId && d.status === 'delivered' && subsOfAgent.some((s) => s.id === d.subscriptionId))
        const distributed = delivered.reduce((s, d) => s + d.quantity, 0)
        const opening = prod.type === 'Newspaper' ? 0 : carry.get(productId) ?? 4
        let received = qty + Math.ceil(qty * 0.05) + (prod.type === 'Newspaper' ? 1 : 0)
        if (date === today && a.id === 'agt_4' && productId === P('KK')) received = Math.max(0, qty - 1) // shortage
        if (date === today && a.id === 'agt_1' && productId === P('VAN')) received = 0
        if (prod.type !== 'Newspaper' && opening >= qty + 2) received = 0
        const returned = date === today ? 0 : prod.type === 'Newspaper' ? (r() < 0.3 ? 1 : 0) : 0
        const damaged = r() < 0.06 ? 1 : 0
        const key = `${date}|${productId}|${a.id}`
        db.stock[key] = { key, date, productId, agentId: a.id, opening, received, distributed, returned, damaged, reconciled: date < today, updatedBy: a.id, updatedAt: `${date}T08:00:00+05:30` }
        carry.set(productId, opening + received - distributed + returned - damaged)
      }
    }
  }

  // ---------------- Complaints ----------------
  const cmp = (customerId: ID, category: DB['complaints'][number]['category'], message: string, daysAgo: number, status: DB['complaints'][number]['status'], reply?: string) => {
    const at = `${addDaysISO(today, -daysAgo)}T08:15:00+05:30`
    db.complaints.push({
      id: `cmp_${db.complaints.length + 1}`,
      number: `CMP-${String(++db.counters.complaint).padStart(4, '0')}`,
      customerId,
      category,
      message,
      status,
      createdAt: at,
      updates: reply ? [{ at: `${addDaysISO(today, -daysAgo + 1)}T10:00:00+05:30`, by: customers.find((c) => c.id === customerId)!.agentId, note: reply, status }] : [],
    })
  }
  cmp('cus_3', 'Missed delivery', 'Manorama not received on Sunday. Please check.', 6, 'resolved', 'Spoke to Akhil — copy was left at the wrong flat. Replacement given.')
  cmp('cus_14', 'Damaged copy', 'Two copies wet due to rain today.', 2, 'in_progress', 'Executive asked to use plastic covers on rainy days.')
  cmp('cus_7', 'Billing', 'Last month bill shows NIE for 31 days, October has 31 days — ok? please confirm.', 1, 'open')
  cmp('cus_22', 'Late delivery', 'Paper coming after 7:30 AM this week.', 0, 'open')

  // ---------------- Notifications ----------------
  const note = (to: string, kind: DB['notifications'][number]['kind'], title: string, body: string, hoursAgo: number, link?: string, read = false) =>
    db.notifications.push({ id: `ntf_${db.notifications.length + 1}`, to, kind, title, body, at: new Date(Date.now() - hoursAgo * 3600e3).toISOString(), read, link })
  const overdue = db.invoices.filter((i) => i.dueDate < today && i.currentBill - i.paid > 0)
  note('role:admin', 'payment_due', 'Overdue collections', `${overdue.length} invoices are past due date across all agents.`, 2, '/collections')
  note('role:admin', 'stock', 'Low stock: Kerala Kaumudi', 'Manoj News Point received fewer copies than today\'s demand.', 3, '/stock')
  note('role:admin', 'registration', 'New customer registration', 'Devika Nair updated her profile and added Balabhumi.', 20, '/customers/cus_22', true)
  note('role:admin', 'delivery', 'Delivery issue reported', 'Late delivery complaint from Peroorkada route.', 1, '/complaints')
  note('role:admin', 'system', 'Price revision scheduled', 'The Hindu will move to ₹13 from next month.', 30, '/pricing', true)
  note('agt_1', 'payment_due', 'Customer payment due', 'Arun Kumar, Rahul Raj, Anoop S and Sreelakshmi Nair have pending dues.', 4, '/collections')
  note('agt_1', 'stock', 'Low stock: Vanitha', 'No Vanitha copies received today for Rajesh News Agency.', 2, '/stock')
  note('agt_1', 'price', 'Product price change', 'Malayala Manorama customer price revised to ₹10.', 24 * 30, '/pricing', true)
  note('agt_2', 'subscription', 'Subscription paused', 'Anu Joseph paused Manorama & Vanitha for 10 days.', 72, '/subscriptions')
  note('agt_4', 'delivery', 'Delivery issue', 'Late delivery complaint from Devika Nair.', 1, '/complaints')
  note('agt_4', 'subscription', 'Subscription changed', 'Adarsh Pillai switched from New Indian Express to Mathrubhumi.', 240, '/subscriptions', true)
  note('exe_1', 'payment_due', 'Collection reminder', 'Collect dues from 4 customers on your route today.', 1, '/collections')
  note('exe_1', 'route', 'Route instructions updated', 'Medical College quarters gate now opens at 5:30 AM.', 50, '/routes')
  note('exe_4', 'route', 'New route assignment', 'You are now assigned to Kowdiar – Palayam (RT-04).', 24 * 24, '/routes', true)
  note('exe_5', 'delivery', 'Schedule update', 'Sreekariyam road blockade — no delivery on the announced date.', 6, '/calendar')
  note('cus_1', 'invoice', 'New invoice', `Your bill for ${fmtMonthName(lastMonthStart)} is ready.`, 24 * daysSinceIssue + 6, '/invoices')
  note('cus_1', 'payment_due', 'Payment due', 'You have an outstanding balance of ₹350.', 5, '/payments')
  note('cus_17', 'subscription', 'Subscription paused', 'Your Manorama & Vanitha deliveries are paused till next week.', 72, '/subscriptions')
  note('cus_3', 'complaint', 'Complaint resolved', 'CMP-0001: replacement copy delivered.', 120, '/complaints', true)

  // ---------------- Activity log ----------------
  const log = (actorId: ID, actorRole: DB['logs'][number]['actorRole'], action: string, entity: string, detail: string, hoursAgo: number) =>
    db.logs.push({ id: `log_${db.logs.length + 1}`, at: new Date(Date.now() - hoursAgo * 3600e3).toISOString(), actorId, actorRole, action, entity, detail })
  log(ADMIN, 'admin', 'price.create', 'Malayala Manorama', 'Customer price ₹9 → ₹10 effective ' + lastMonthStart, 24 * 35)
  log(ADMIN, 'admin', 'price.schedule', 'The Hindu', 'Future price ₹13 effective ' + nextMonthStart, 30)
  log('agt_2', 'agent', 'route.handover', 'Kowdiar – Palayam', 'Arjun Das → Rahul S', 24 * 24)
  log('agt_4', 'agent', 'subscription.change', 'Adarsh Pillai', 'New Indian Express → Mathrubhumi', 240)
  log(ADMIN, 'admin', 'invoice.generate', `${fmtMonthName(lastMonthStart)} billing`, `${db.invoices.filter((i) => i.periodStart === lastMonthStart).length} invoices generated`, 24 * daysSinceIssue + 7)
  log('exe_1', 'executive', 'delivery.round', 'Kumarapuram – Medical College', 'Morning round in progress', 1)
  log(ADMIN, 'admin', 'holiday.create', 'Sreekariyam Road Blockade', 'Regional holiday, delivery suspended', 6)

  return db
}

function fmtMonthName(iso: string) {
  return fromISO(iso).toLocaleString('en-IN', { month: 'long', year: 'numeric' })
}
