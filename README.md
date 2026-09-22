# ShiftSync

Multi-location restaurant staff scheduling. Next.js (App Router) + TypeScript,
Drizzle ORM on Postgres, deployed to Railway as a single long-running Node
service with a Railway Postgres database.

Managers build and publish schedules across four locations in two timezones;
staff see their own week and pick up open shifts. The scheduling rules are
enforced by the database and the service layer rather than by the UI, so they
hold under concurrent writes.

## Signing in

Demo sign-in with no passwords — three seeded accounts, one click each.
See [Authentication](#authentication) for why this is not production auth.

| Role | Sees |
| --- | --- |
| **Admin** | Every location |
| **Manager** | Only locations they are assigned to (Mission Bay & Santa Monica) |
| **Staff** | Only their own shifts, and open shifts they can pick up |

Accounts come from `npm run seed`: `admin@shiftsync.test`,
`manager@shiftsync.test`, `staff@shiftsync.test`.

## Screens

| Route | Role | What it does |
| --- | --- | --- |
| `/overview` | admin, manager | Every location for the week: unfilled slots, hours, projected wages, publish state |
| `/schedule` | admin, manager | The week grid. Create, edit, delete and publish shifts; assign and unassign; click an open shift to see who can cover it |
| `/team` | admin, manager | Everyone, with hours **split by location** — how cross-location over-booking becomes visible |
| `/reports` | admin, manager | Overtime exposure, hours against stated preference, premium Friday/Saturday-evening distribution |
| `/my-shifts` | all | Your published shifts, plus open shifts you are eligible to pick up |
| `/debug/events` | any | Temporary SSE harness. Delete before shipping |

## What the system enforces

Refused at the service layer or by a database constraint — never only in the UI:

- **No double-booking**, and **at least 10 hours between shifts**, by one Postgres
  exclusion constraint that holds under concurrent writers
- **Headcount** — serialised with a row lock, so two managers cannot both take
  the last seat
- **Required skill**, **location certification** and **availability window**,
  each reported with a reason a manager can act on
- **Publication** — a draft schedule is invisible to staff and cannot be
  picked up
- **Optimistic locking** on shift edits, so a second manager's edit is refused
  rather than silently overwriting the first

---

## Local setup

Requires Node 20.12+ (the env loader uses `process.loadEnvFile`).

```bash
npm install
cp .env.example .env.local     # set DATABASE_URL
npm run migrate
npm run seed
npm run dev
```

Check it came up:

```bash
curl -s localhost:3000/api/health     # {"status":"ok"}
npm test                              # integration test, needs a real database
```

## Environment variables

### `DATABASE_URL` — the only variable the app requires

Everything uses it: route handlers, server actions, migrations, seeds and
tests. Backed by a `pg.Pool` in `lib/db/index.ts`.

On Railway, add a Postgres service and reference it so the value tracks the
database automatically:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

For local development against that same database, use the Postgres service's
**public** URL (`DATABASE_PUBLIC_URL` in Railway's Variables tab). The internal
`postgres.railway.internal` host only resolves from inside the Railway project.

### `AUTH_SECRET`

Signs session cookies. Any long random string:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Rotating it invalidates every outstanding session.

Both are read through `lib/env.ts`, which falls back to `.env.local` / `.env`
for the entry points Next does not cover (drizzle-kit, `tsx`, vitest). Real
environment variables always win, so Railway's values are never shadowed.

## The scheduling invariant

Two rules — no double-booking, and at least 10 hours off between shifts — are
enforced by one Postgres exclusion constraint, in
`drizzle/0001_no_overlap_or_short_rest.sql`:

```sql
EXCLUDE USING gist (
  staff_id WITH =,
  shiftsync_rest_window(starts_at, ends_at) WITH &&
) WHERE (status = 'active')
```

where `shiftsync_rest_window(s, e)` is `tstzrange(s, e + interval '10 hours', '[)')`.

Padding each row's range on the end side by the rest period means two padded
ranges intersect exactly when the shifts overlap **or** the gap between them is
under 10 hours. Half-open bounds make a gap of exactly 10 hours legal.

This lives in the database rather than in application code because a
`SELECT`-then-`INSERT` check does not survive concurrency: two requests can both
read "no conflict" before either writes. The constraint is evaluated by the
index under proper locking, so one writer blocks and then fails — and the rule
holds regardless of what does the writing.

**Two details worth knowing before you edit that migration:**

- `timestamptz + interval` is only `STABLE`, so writing the expression inline
  fails with *"functions in index expression must be marked IMMUTABLE"*. The
  `shiftsync_rest_window` wrapper exists to solve this. Declaring it `IMMUTABLE`
  is accurate rather than a loophole: adding an **hours** interval to a
  `timestamptz` is a fixed number of seconds under every session timezone, which
  is not true of days or larger (a calendar day is 23 or 25 hours across a DST
  transition). Keep the interval in hours.
- Changing the rest period means dropping the constraint, replacing the
  function, and re-adding the constraint, which rebuilds the index.

`assignments.starts_at` / `ends_at` are denormalized from `shifts` because a
table constraint can only see its own row. The cost is a sync obligation: any
transaction that moves a shift's times must update its active assignments
before it commits.

### Time model

- Every **instant** is `timestamptz`. No column pair anywhere splits an instant
  into a separate date and time.
- **Availability** is wall-clock: a local `time` (and, for exceptions, a local
  calendar `date`) plus the staff member's own IANA timezone on
  `staff.availability_tz`, resolved to instants at query time. "I work
  09:00–17:00 on Tuesdays" stays true across a DST transition precisely because
  it is never frozen into a UTC offset.

---

## Authentication

**This is demo-scoped auth, chosen deliberately for a take-home. It is not
production auth.**

A session is a `{userId, role}` payload plus an HMAC-SHA256 signature over it,
stored in an httpOnly cookie. `node:crypto` only — no dependency. Verification
uses `timingSafeEqual`, so a forged signature cannot be discovered by timing the
comparison.

`/login` has three one-click buttons backed by accounts created by
`npm run seed`. There are no passwords, no registration and no password reset.
The role written into the session comes from the database row, never from the
submitted form, so a crafted POST cannot mint an admin session.

What makes it demo-scoped rather than production-ready:

- The signature carries **no expiry**. A leaked cookie stays valid until
  `AUTH_SECRET` is rotated; the 8-hour lifetime is enforced only by the cookie's
  `Max-Age`, which a client controls.
- There is no session revocation, rotation, or device list.
- No credentials exist to protect, because there are no passwords.

Real auth would mean password hashing, an `exp` claim checked server-side, and
a revocation story.

### Where authorization lives

`requireRole()` is called from service functions in `lib/scheduling/*`, not from
route handlers or server actions. A check in the caller only protects that one
caller; the next one that forgets it opens a hole. Route handlers and actions
translate input and responses and nothing else.

## Layout

```
app/
  overview/ schedule/ team/ reports/ my-shifts/   screens (page + layout + actions)
  schedule/_components/                            grid, toolbar, dialogs, live-update hook
  api/events/[locationId]/  api/health/            SSE stream · healthcheck
  login/                                           demo sign-in
components/
  ui/           button · modal · feedback (Alert, Badge, Card, EmptyState, PageHeader)
  layout/       app-shell · sidebar · nav-items · shell-layout · protected-page
  icons.tsx     inline SVGs, so no icon-library dependency
lib/
  auth.ts       signed-cookie sessions, requireRole
  format.ts     time, date and money formatting
  db/           drizzle client and schema
  realtime/     in-process event bus
  scheduling/   access · assign · eligibility · shifts · schedule · suggestions
                insights · week-view · errors
drizzle/        migrations; 0001 holds the exclusion constraint
```

Business logic lives in `lib/scheduling/*` as plain functions. Route handlers and
server actions translate input and responses and nothing else; authorization sits
in the service layer so a second caller cannot skip it.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Local dev server |
| `npm run build` | Production build |
| `npm start` | `next start -p ${PORT:-3000}` — Railway's start command |
| `npm run generate` | Generate a migration from schema changes |
| `npm run migrate` | Apply migrations |
| `npm run seed` | Seed 4 locations across two timezones |
| `npm test` | Vitest integration tests against a real database |
| `npm run typecheck` | `tsc --noEmit` |

---

## Real-time

A schedule change is announced by a service function in `lib/scheduling/*`
calling `publishScheduleChange()` **after its transaction commits**, never
inside it — an in-process emitter has no rollback, so announcing early would
tell subscribers about writes that never landed. `/api/events/[locationId]`
holds an SSE stream per client and filters on location.

**Fan-out is in-process and assumes a single instance.** Every subscriber lives
in the same Node process that emitted the event, so a second instance would
never see the first one's changes. Scaling out would move this to Postgres
`LISTEN`/`NOTIFY` (or an external broker) and give the listener its own
long-lived connection — which is also why `numReplicas` is pinned to 1.

`/debug/events` opens an `EventSource` and prints what arrives. Paste a location
id from `npm run seed`, hit Connect, then create an assignment — that emits.
Events can no longer be injected from `psql`, since nothing listens on a
Postgres channel any more.

Do this against the deployed app, not just locally — a proxy in front of the
service is the usual reason streaming breaks, and it will not reproduce on
localhost. Heartbeats are SSE comment lines, so `EventSource` ignores them by
design; watch the Network tab if you want to see them land.

## Deploying to Railway

Most of the deploy configuration is committed in [`railway.json`](railway.json),
validated against Railway's published schema. Railway reads it automatically —
there is nothing to click for any of this:

| Setting | Value | Why |
| --- | --- | --- |
| `startCommand` | `npm start` | `next start -p ${PORT:-3000}`, honouring Railway's injected `$PORT`. |
| `preDeployCommand` | `npm run migrate` | Migrations run before the new container takes traffic. |
| `healthcheckPath` | `/api/health` | Returns 503 when the database is unreachable, so a broken deploy fails instead of serving errors. |
| `numReplicas` | `1` | The bus is per-process and in-memory, so a second replica would never see the first one's events. Required, not a preference. |
| `sleepApplication` | `false` | A sleeping service drops every open SSE stream, and the bus lives in process memory. Real-time silently dies until the next request wakes it. |
| `restartPolicyType` | `ON_FAILURE` (max 10) | Restart on crash, but stop flapping forever. |

`engines.node` is `>=20.12`, which Railpack reads to pick the runtime. That
floor is real, not cosmetic: `lib/env.ts` uses `process.loadEnvFile`, added in
Node 20.12.

`drizzle-kit` is a **production** dependency rather than a dev one. It has to
be, because it runs as the pre-deploy command inside the deployed image, and
Railpack can prune dev dependencies (`RAILPACK_PRUNE_DEPS`). Verified against
`npm ci --omit=dev`.

### Steps you have to do yourself

1. **Create the Railway project** and point it at this repository.
2. **Add a Postgres service** to the same project (New → Database → Postgres).
3. **Set one service variable** on the app service:
   `DATABASE_URL=${{Postgres.DATABASE_URL}}`. That reference form means the
   value follows the database if it is ever recreated.
4. **Deploy.** The pre-deploy step runs migrations, including the `btree_gist`
   extension and the exclusion constraint.
5. **Verify** — `curl https://<your-app>.up.railway.app/api/health` should
   return `{"status":"ok"}`, then open `/debug/events` and push an event from
   `psql` as described above.

The build itself does **not** need the database variables — connections are
created lazily, so `next build` succeeds without secrets and only the running
service needs them. If the variables are missing at runtime, `/api/health`
returns 503 and the deploy fails its healthcheck rather than crash-looping.

No Dockerfile, and `output: 'standalone'` is deliberately not used. Beyond the
brief asking for it, standalone would strip the source tree that
`npm run migrate` needs at pre-deploy time.

## Known limitations

- **Swap and drop are not built.** The schema supports them (`kind`,
  `target_assignment_id`, `expires_at`, peer-then-manager approval states, and a
  CHECK enforcing swap-XOR-drop) but there is no service layer or UI. Staff can
  pick up open shifts; they cannot hand one back.
- **Overtime rules are reported, not enforced.** `/reports` flags anyone at 35
  hours or more and marks past 40, but nothing blocks a daily 8/12-hour breach
  or a 6th/7th consecutive day. `compliance_overrides` exists for the documented
  manager override and is unused.
- **Staff cannot edit their own availability.** Availability is seeded and
  enforced, but there is no screen for it.
- **Clock in/out is schema only** — `assignments.clocked_in_at/clocked_out_at`
  exist, so an "on duty now" board has somewhere to read from, but it is not
  built.
- **Notifications are not delivered.** The table exists; nothing writes to it,
  and notification preferences and email simulation are schema only.
- **`authorizeAssignment` has no automated test.** It reads the session from
  request context, which vitest cannot provide; it was verified by hand over
  HTTP. The eligibility rules beneath it are unit-tested.
- **One instance only.** Real-time fan-out is in-process, so `numReplicas` is
  pinned to 1. Scaling out means moving `lib/realtime/bus.ts` back to Postgres
  `LISTEN`/`NOTIFY`.

## Dependency note

`npm audit` reports a moderate advisory (GHSA-67mh-4wv8-2f99) against `esbuild`,
reachable only through `drizzle-kit`. Because `drizzle-kit` is a production
dependency here — it runs the pre-deploy migration — this shows up in
`npm audit --omit=dev` too. The advisory concerns esbuild's *dev server*, which
nothing in this project starts; `drizzle-kit` uses esbuild only to bundle
`drizzle.config.ts`. The one non-breaking fix is `drizzle-kit@0.18.1`, which
predates the migration commands this project relies on. Left alone deliberately.
