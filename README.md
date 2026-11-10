# NewsRound: Newspaper, Magazine & Distribution Management Platform

NewsRound is a PWA for running a newspaper and magazine agency. It covers subscriptions, a dynamic delivery calendar, route handover, three-level pricing, automatic billing, collections, stock and settlement. The sample data is set in Kerala (Thiruvananthapuram first, then other cities).

```
frontend/   React 19 + TypeScript + Vite 8 + Tailwind 4 + shadcn-style UI (Radix) + Recharts + Leaflet + vite-plugin-pwa
backend/    Django 6.1 + DRF + SimpleJWT + PostgreSQL (SQLite fallback) + optional PostGIS
env/        Python virtualenv (existing)
```

## Run it

**Frontend (the full prototype, which runs entirely in the browser):**

```bash
cd frontend
npm install
npm run dev            # http://localhost:5173
```

**Production build and PWA (service worker, offline, installable):**

```bash
npm run build && npm run preview   # http://localhost:4173
```

**Backend API:**

```bash
env\Scripts\pip install -r backend\requirements.txt
cd backend
copy .env.example .env             # set DB_ENGINE=postgres for PostgreSQL; default is SQLite
..\env\Scripts\python manage.py migrate
..\env\Scripts\python manage.py seed_demo      # loads the same Kerala dataset the frontend uses
..\env\Scripts\python manage.py test crm       # 7 end-to-end API tests
..\env\Scripts\python manage.py runserver      # http://127.0.0.1:8000/api/
```

## Demo sign-in

The login screen order is: account type first, then mobile number, then Continue. Account type is never preselected.

The first sign-in uses a **simulated OTP**. The code appears on screen with an Autofill button. After that you create a 4-digit MPIN. Later sign-ins need only the MPIN. The "Sample accounts" box on the login page fills in a role and mobile number for you.

| Role | Name | Mobile |
|---|---|---|
| Super Administrator | Harikrishnan Nair | 9847012345 |
| Distribution Agent | Rajesh Kumar | 9447021001 |
| Delivery Executive | Akhil S | 8547031002 |
| Customer | Arun Kumar | shown on the login screen |

**Settings → Reset demo data** restores the original dataset and keeps your MPINs.

After an MPIN is created or reset (first sign-in, Forgot MPIN, or new customer registration), the user is signed in straight to their own dashboard. The sign-in wizard survives a page reload, and an expired verification sends a fresh OTP instead of failing.

## Appearance

The "Prism" design: frosted-glass blocks over a live, slowly moving colour field (drifting gradient clouds, a dot grid and a few rising lights), a deep-gradient sidebar and mobile drawer, and gradient accents on buttons, icon chips, progress bars, badges, input focus borders and headline names. Bricolage Grotesque sets headlines, titles, figures and labels; Plus Jakarta Sans sets body text, forms and tables. Light, dark or automatic mode, and six gradient themes (Indigo Tide, Sunset, Orchid, Ocean, Emerald, Ember). Use the sun/moon and palette buttons in the header, or **My profile → Appearance**. The choice is saved per device and applied before first paint; switching wipes the new edition across like a turning page.

The background (gradient clouds, dot grid and rising lights) and all 3D motion are CSS transforms and opacity only, so it runs on the GPU compositor: the turning broadsheet on the sign-in screen and dashboard front pages (paused when off screen, tipping back as you scroll), cards that rise off the page as they scroll into view (scroll-driven animations, no JavaScript), figure boxes laid down with split-flap numbers, pages and tabs that unfold, and pointer tilt with glare on clickable figure boxes (one passive listener in app/tilt.ts, mouse only, one CSS-variable write per frame). Frosted blur on content blocks is applied on desktop only; phones get the same translucent tint without the blur cost. The sign-in page always fits one screen. Motion is always on; `prefers-reduced-motion` is still respected. Chart colours have separately validated light and dark steps.

Delivery executives carry an alternate mobile number and how that person is related to them (Father, Spouse, …). Both are required when adding or editing an executive, the number must differ from the executive's own, and it is visible to staff only — subscribers never receive it.

## How the core rules are guaranteed

| Rule | How |
|---|---|
| Delivery calendar never duplicates | The schedule is derived from subscriptions every time and is never stored. Only outcomes are stored, keyed by `subscription + date`: `DeliveryRecord` in the backend has a unique constraint, and the frontend uses a keyed map. |
| Calendar updates instantly | Creating, editing, pausing, resuming, expiring or cancelling a subscription, or adding a holiday, is reflected on the next render, because the calendar is computed from that data. |
| Holidays and strikes don't reduce bills | `billableDeliveries` excludes only paused days. A concession is an approved **invoice adjustment** and never an edit to line items. |
| Historical prices are preserved | Prices are versioned by effective date. Invoice lines snapshot the unit, agent and purchase price, and a period that crosses a price change is billed in separate segments. |
| Agent pricing and discount limits | Agent rates must stay within ±`agentPriceMaxMarkupPct` of the base price. Each agent has a `maxDiscountPct` ceiling, checked against the real monthly bill. |
| No duplicate payments | Every payment carries an idempotency key. Replays return the original receipt. Money is allocated first-in, first-out across open invoices, and older dues carry forward. |
| Offline field work | Delivery marks and cash collections are queued on the device and sync when the connection returns, safely because of the idempotency keys. Only IDs and amounts are queued: no addresses and no credentials. |
| Products in use can't be deleted | If a product is linked to invoices, subscriptions or deliveries, deleting it archives it instead. |
| Role-based access | One permission matrix plus per-role scoping, implemented in `frontend/src/domain/access.ts` and `backend/core/access.py`. |
| Route handover | Stops, map pins, instructions and schedules move to the new executive immediately. Past history stays credited to the previous executive. |

## Modules

Dashboards (one per role) · Customers (profile with 10 tabs) · Agents · Delivery Executives · Products · Three-level Pricing · Locations (hierarchy with pincode search) · Subscriptions (create, edit, pause, resume, cancel, renew, change, history) · Delivery Calendar (month, week and day views) · Holidays & Strikes · Routes & Map (OpenStreetMap, sequence optimisation, handover) · Daily Delivery Checklist (works offline) · Delivery History · Stock ledger and reconciliation · Billing & Invoices (generate, PDF, print, adjustments) · Payments (simulated UPI and card gateway, receipts) · Collections & dues · Discounts · Agent Settlement and remittances · Reports (10, exportable to CSV and PDF, including the legacy-style Delivery Slip) · Complaints · Notification centre (Web Push ready) · Back-log (activity log with date and agency filters) · Settings.

**Super Administrator menu.** The admin sees only the options of the legacy super-admin panel, drawn in the app's own theme: Dashboard (License Admin Console, six counters) · Account Verification · Active Accounts (Lock, Truncate, Root Login, Delete) · **Agent Console** (Subscription Type, Manage Products with companies and titles, Product Wise Rate by weekday, issue and special rate, Area Masters, Language, Product Type, Mode of Pay) · Send Information · Resellers / Agent · Control Room · Billing (licence plans) · BACK - LOG (date range and agency filters) · Change Password (the MPIN). Delete and Truncate are refused once an agency or product has invoices, subscriptions or payments, and rows still in use show a padlock. This part runs on the mock server only; the Django API does not have these tables yet. 

**Agency (agent) menu**, also modelled on the legacy panel: Dashboard (Agent Console: six counters for a date range, Cash Flow, Active Users) · Master (Subscription Type, Manage Products, Product Wise Rate, Manage Route, Manage Delivery Boys, CRM: Customer Details and Manage Subscriptions with an All Day or Individual Day grid) · Transactions (Manage Bill Adjustment, Bill, Delivery Slip, Payment Collection Entry, Profit Forecasting, Profit & Loss Statement) · Reports (Customer Data Listing, Customer Wise Subscription, Payment Due, Payment Collected, Bill Details, Product List, Transfer Delivery Boy, Customer Report, Sales Report) · Settings (Profile, Subscription Info, Bill Serials, Change Password, Handling Charge Setting, User Roll, Rate Setting, User, Mode of Pay). Each agency keeps its own subscription types, payment modes, companies and titles; the main agency's titles are shared and an agency sets its own rate on them. Titles an agency creates itself are left out of the settlement with the main agency. Executive and customer menus are unchanged.

## What is simulated in the prototype

- **OTP SMS:** the code is shown on screen. In the backend, `OTP_DEMO_MODE=true` returns it in the API response.
- **Payment gateway:** it always runs in simulated mode. Every payment is marked "Demo gateway", has `simulated=true` and a `SIM-` reference. No card or UPI details are ever collected.
- **The frontend runs on an in-browser mock server** (`src/services/api.ts`, saved to localStorage). It enforces the same validation and permissions as the Django API. `src/services/http.ts` is the REST client to switch to (`VITE_API_MODE=http`). Wiring each screen to the HTTP calls is the next integration step.
- **PostgreSQL and PostGIS:** the configuration is in place, but this machine has no PostgreSQL, so the tests ran on SQLite.
