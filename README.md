# CommissionDisputeLedger

An independent audit and reconciliation layer for sales commission payouts. CommissionDisputeLedger re-derives, from raw closed-won deals and a versioned comp-plan model, exactly what every rep *should* have been paid, reconciles that expected payout line-by-line against what the commission run *actually* paid, and turns every discrepancy into a tracked dispute case backed by a transparent calculation trail.

It is deliberately not a forward commission calculator. It is the second opinion: the shadow ledger RevOps already rebuilds by hand in spreadsheets every pay period, made systematic, auditable, and shareable. Every number on the screen can be expanded into the exact rule, rate, tier, accelerator, cap, and split that produced it.

See [`docs/idea.md`](docs/idea.md) for the full feature specification.

## Core capabilities

- **Workspaces & membership** — workspace-scoped artifacts, email-as-userid invites, owner/analyst/viewer roles.
- **Comp plan modeler** — encode complete commission plans as structured, immutably versioned data; re-derivations pin to a version.
- **Rate tiers & accelerators** — ordered attainment tiers, accelerators, per-period and per-deal caps, draw guarantees, with gap/overlap validation.
- **Split rules** — divide deal credit across reps/roles with reject/normalize/flag policies when splits do not sum to 100%.
- **Reps & roster** — the people whose comp is audited, mapped to plans, quotas, and deals.
- **Independent re-derivation engine** — deterministic recomputation of expected payout from raw deals and a pinned plan version.
- **Line-by-line reconciliation** — expected vs. actually-paid, surfacing overpayments, underpayments, and split mismatches.
- **Dispute case manager** — records the claim, the disputed deals, the calculation, and the resolution as a permanent audit record.

## Stack

- **Backend:** Hono (TypeScript, ESM) on `@hono/node-server`, run with `node --import tsx/esm` (no runtime compile step). Drizzle ORM over Neon serverless Postgres. Zod validation. Auth via a trusted `X-User-Id` header injected by the frontend proxy.
- **Frontend:** Next.js 16 (App Router), React 19, TypeScript strict, Tailwind 4. Auth via `@neondatabase/auth` (Neon Auth). A same-origin `/api/proxy/*` route resolves the session server-side and forwards `X-User-Id` to the backend.
- **Database:** Neon Postgres. Schema is provisioned out-of-band (drizzle schema pushed via Neon); the app only runs an idempotent seed on boot.
- **Deploy:** Backend on Render (`render.yaml`), frontend on Vercel. `docker-compose.yml` brings backend + web up together locally.

## Local development

Prerequisites: Node 22, pnpm, and a Neon (or local) Postgres database.

### Backend

```bash
cd backend
pnpm install
cp .env.example .env   # set DATABASE_URL, FRONTEND_URL
pnpm dev               # http://localhost:3001 (GET /health -> { ok: true })
```

### Frontend

```bash
cd web
pnpm install
cp .env.example .env.local   # set NEON_AUTH_*, NEXT_PUBLIC_API_URL
pnpm dev                     # http://localhost:3000
```

Or run both together with Docker:

```bash
docker compose up --build
```

## Environment variables

### Backend (`backend/.env`)

| Variable | Description |
|----------|-------------|
| `PORT` | Listen port (default `3001`; Render injects `10000`). |
| `DATABASE_URL` | Neon/Postgres connection string (`?sslmode=require`). |
| `FRONTEND_URL` | Allowed CORS origin for the web app (default `http://localhost:3000`). |
| `ADMIN_USER_IDS` | Optional comma-separated list of admin user ids. |
| `STRIPE_SECRET_KEY` | Optional. Billing endpoints return 503 when unset. |
| `STRIPE_PRO_PRICE_ID` | Optional. Required only for checkout. |
| `STRIPE_WEBHOOK_SECRET` | Optional. Required only for the webhook. |

### Frontend (`web/.env.local`)

| Variable | Description |
|----------|-------------|
| `NEON_AUTH_BASE_URL` | Neon Auth endpoint base URL (server-only). |
| `NEON_AUTH_COOKIE_SECRET` | Random 32-byte hex cookie secret (server-only). |
| `NEXT_PUBLIC_API_URL` | Backend base URL, baked into the bundle; read by the proxy route. |

## Pricing

All features are free for any signed-in user. Stripe billing is wired but optional: billing endpoints return `503` when `STRIPE_SECRET_KEY` is unset, and the `plans`/`subscriptions` tables exist so a paid tier can be switched on later without a migration.
