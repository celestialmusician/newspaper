# NewsRound API (Django + DRF)

## Apps

| App | Models |
|---|---|
| `accounts` | `User` (role + mobile + MPIN hash), `AgentProfile`, `ExecutiveProfile`, `CustomerProfile`, `OtpChallenge` |
| `geo` | `Location` (country → state → district → city → locality → area; pincode, lat/lng) |
| `catalog` | `Product`, `PriceVersion` (three-level, effective-dated, optional per-agent override) |
| `crm` | `Subscription`, `SubscriptionPause`, `SubscriptionEvent`, `Discount` |
| `distribution` | `Holiday`, `Route`, `RouteStop`, `Handover`, `DeliveryRecord` (unique per subscription and date), `StockEntry` (unique per date, product and agent) |
| `billing` | `Invoice` (unique per customer and period), `InvoiceLine` (price snapshot), `InvoiceAdjustment`, `Payment` (unique idempotency key), `PaymentAllocation`, `Remittance` |
| `engagement` | `Notification`, `PushSubscription`, `Complaint`, `ComplaintUpdate`, `ActivityLog`, `SystemSettings` |
| `core` | Services: `schedule.py`, `pricing.py`, `billing.py`, `access.py`. These are Python ports of the frontend domain engines. |

## Endpoints (`/api/…`, JWT Bearer)

| Area | Endpoint |
|---|---|
| Auth (public) | `auth/lookup/`, `auth/otp/request/`, `auth/otp/verify/`, `auth/mpin/set/`, `auth/mpin/login/`, `auth/register/`, `auth/refresh/`, `auth/me/` |
| People | `agents/`, `executives/`, `customers/` (scoped by role) |
| Catalogue | `locations/?parent=&level=&pincode=`, `products/` (DELETE archives products that are in use), `prices/`, `prices/resolve/` |
| Subscriptions | `subscriptions/` + `{id}/pause|resume|cancel|renew|change|history/` |
| Calendar | `calendar/?from=&to=&customer=&route=&product=` (derived occurrences) |
| Delivery | `deliveries/`, `deliveries/mark/` (idempotent upsert), `holidays/`, `routes/` + `{id}/stops/` (PUT) + `{id}/handover/` |
| Stock | `stock/` (POST upserts), `stock/{id}/reconcile/` |
| Billing | `invoices/`, `invoices/generate/`, `invoices/preview/`, `invoices/{id}/adjust/` |
| Payments | `payments/collect/` (cash), `payments/pay_online/` (simulated gateway), `payments/{id}/verify/`, `remittances/` |
| Engagement | `discounts/` + `{id}/revoke/`, `complaints/` + `{id}/respond/`, `notifications/` + `mark_read/` + `push_subscribe/`, `activity/` (admin only), `settings/`, `dashboard/` |

## PostgreSQL / PostGIS

Set `DB_ENGINE=postgres` and the `DB_*` variables in `.env`. To use PostGIS, also set `USE_POSTGIS=true`, run `CREATE EXTENSION postgis;`, and install GDAL/GEOS. Coordinates are stored as portable lat/lng floats, with an index on customers. Adding a `PointField` plus a GiST index is a single migration once PostGIS is available.

## Production checklist

- Set `OTP_DEMO_MODE=false` and send the OTP through an SMS provider in `accounts/api.py::otp_request`.
- Integrate a payment gateway: create an order, then confirm it from a webhook, then call `core.billing.record_payment`.
- Set `VAPID_*` and send push messages to `PushSubscription` rows from `engagement.services.notify`.
