# ShiftSync

Shift scheduling for a restaurant group with four locations across two
timezones. Managers build and publish schedules; staff see their own week, pick
up open shifts, swap, and set their availability.

The scheduling rules are enforced by the database and the service layer, never
by the UI, so they hold even under concurrent writes.

---

## Running it

Needs Node 20.12+ and a Postgres database.

```bash
npm install
cp .env.example .env.local     # set DATABASE_URL and AUTH_SECRET
npm run migrate                # schema + the exclusion constraint
npm run seed                   # 4 locations, 11 people, a week of shifts
npm run dev
```

| Script | Does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run migrate` | apply migrations (also runs pre-deploy on Railway) |
| `npm run seed` | **destructive** — resets to a known demo dataset |
| `npm test` | Vitest, against a real database |
| `npm run typecheck` | `tsc --noEmit` |

Two environment variables: `DATABASE_URL`, and `AUTH_SECRET` for signing session
cookies. `DATABASE_URL_UNPOOLED` is optional and only needed if you put a
transaction-mode pooler in front of Postgres, which breaks `LISTEN`.

---

## Signing in

`/login` lists every seeded person. Pick anyone to see the app as they see it —
there are no passwords. Three roles:

| Role | Sees |
| --- | --- |
| **Admin** (Michael Scott) | every location |
| **Manager** (Pam Beesly, Andy Bernard) | only locations they run |
| **Staff** (everyone else) | their own shifts, and schedules where they're certified |

---

## The screens

| Route | Who | What it does |
| --- | --- | --- |
| `/overview` | manager | Every location for the week: unfilled slots, hours, projected wages, publish state |
| `/schedule` | everyone | The week, as a **calendar grid** or a **list**. Managers create, edit, delete, assign, unassign and publish; staff get the same views read-only, and never see drafts |
| `/on-duty` | manager | Who is clocked in per location right now, who is late, who never showed |
| `/team` | manager | Everyone, with hours **split by location** — how cross-location over-booking becomes visible |
| `/reports` | manager | Overtime exposure, hours against stated preference, premium Fri/Sat-evening distribution |
| `/requests` | manager | Swaps and drops both parties agreed, awaiting approval |
| `/audit` | manager | Every schedule change; admins export CSV by date range and location |
| `/my-shifts` | staff | Your week, clock in/out, offer a shift up, pick up open shifts |
| `/my-availability` | staff | Recurring weekly windows and one-off exceptions, in your own timezone |
| `/my-requests` | staff | Your swaps and drops, plus shifts colleagues have offered up |
| `/notifications` | everyone | Notification centre with read/unread and the email-simulation toggle |

---

## How the rules are enforced

This is the core of the app. Nothing below can be bypassed by calling a
different route, because none of it lives in the UI.

**In the database** — `drizzle/0001_no_overlap_or_short_rest.sql`

One exclusion constraint enforces two rules at once: no double-booking, and at
least 10 hours between shifts. Each assignment's range is padded on the end by
the rest period, so two padded ranges intersect exactly when the shifts overlap
*or* the gap is under 10 hours. It holds under concurrent writers because the
index evaluates it under proper locking — a `SELECT`-then-`INSERT` check would
not.

**In the service layer** — `lib/scheduling/eligibility.ts`

| Rule | Effect |
| --- | --- |
| Shift already at headcount | blocks (serialised with a row lock, so two managers can't both take the last seat) |
| Missing the required skill | blocks |
| Not certified at that location | blocks |
| Outside their availability | blocks |
| More than 12 hours in a day | blocks — explicitly not overridable |
| 7th consecutive day | blocks unless a manager records a reason in `compliance_overrides` |
| Over 8 hours in a day · 35+ hours in a week · 6th consecutive day | warns, never blocks |

Refusals name the person and the reason: *"This shift requires host, and Dwight
Schrute has line cook."* Warnings appear in the coverage dialog before you
confirm, and clean candidates sort ahead of flagged ones.

**Authorization** lives in the service layer too, defaulting to the authenticated
path. Seeds and tests must opt out explicitly with a `system` actor rather than
authorization being opt-in. `requireRole` re-reads the staff row on every call,
so a deleted account or a changed role takes effect immediately rather than when
the cookie expires.

---

## Time and timezones

- Every instant is `timestamptz`. No column pair anywhere splits an instant into
  a date and a time.
- **Shifts** display in the *location's* timezone — the clock you turn up
  against.
- **Availability** is wall-clock time plus the staff member's own timezone,
  resolved at query time. "09:00–17:00 on Tuesdays" stays true across DST
  because it is never frozen to a UTC offset.
- **Daily and weekly limits** are counted in the staff member's own timezone —
  their day, their week.
- Day bucketing happens in Postgres via `AT TIME ZONE`, so the server's own
  timezone can never shift a shift into the wrong column.
- A shift ending before it starts is treated as overnight: 11pm–3am is one
  shift.

---

## Real-time

Two server-sent event streams, both fed by an in-process `EventEmitter`
(`lib/realtime/bus.ts`):

- `/api/events/[locationId]` — schedule changes, filtered by location. The
  schedule grid and on-duty board refresh on them.
- `/api/notifications/stream` — filtered by signed-in user. Drives the toast and
  the unread badge on **Alerts**.

Both carry a *hint*, not the payload: the client refetches. That makes a missed
event harmless, so clients also refresh on **reconnect**, and an event emitted
inside a transaction that later rolls back costs nothing.

**Fan-out is in-process, so this assumes a single instance.** `numReplicas` is
pinned to 1 in `railway.json`. Scaling out means moving the bus back to Postgres
`LISTEN`/`NOTIFY`, which is confined to that one file.

---

## Swaps and drops

A **swap** trades two named assignments between two named people. A **drop**
offers one shift to anyone qualified and expires 24 hours before it starts. One
CHECK constraint enforces that a row is wholly one or the other.

The workflow is two-staged — a peer accepts, then a manager approves — and
**nothing moves on the schedule until approval**. That's what lets someone
withdraw after their counterparty agreed without leaving a shift uncovered.
Approval moves both assignments in one transaction, so if the trade would
double-book anyone the whole thing rolls back.

Limits: three open requests per person, one live request per shift (a partial
unique index, so two fast clicks can't both get through), and editing a shift
cancels any pending request against it.

---

## Data model

16 tables. Full diagram and rationale in [docs/schema.md](docs/schema.md);
design decisions and assumptions in [docs/decisions.md](docs/decisions.md).

The one deliberate denormalization: `assignments` copies `starts_at`/`ends_at`
from `shifts`, because a table constraint can only see its own row. The cost is
a sync obligation — any transaction moving a shift must move its assignments in
the same transaction, which `updateShift` does.

`audit_log` and `email_log` use `ON DELETE SET NULL` and polymorphic ids so the
record outlives whatever it describes.

---

## Layout

```
app/            one folder per screen: page + layout + actions
  api/          SSE streams, health, CSV export
components/
  ui/           button · modal · toast · feedback primitives
  layout/       app shell · sidebar · notification watcher
lib/
  auth.ts       signed-cookie sessions, requireRole
  db/           drizzle client and schema
  realtime/     in-process event bus
  scheduling/   all business logic as plain functions
drizzle/        migrations; 0001 holds the exclusion constraint
```

Business logic is plain functions in `lib/scheduling/*`. Route handlers and
server actions translate input and responses and nothing else.

---

## Testing

`npm test` — 42 tests against a **real Postgres**, no mocks. The database
constraint is the thing under test, so mocking it would mock the only component
whose behaviour is in question.

The concurrency tests fire genuinely simultaneous writes and assert exactly one
wins: two people racing for the last seat, and two conflicting assignments
racing on the rest rule.

---

## Deploying

Railway, configured in `railway.json`: Railpack build, `npm run migrate` as
pre-deploy, healthcheck on `/api/health`, one replica, sleeping off.

Set `DATABASE_URL=${{Postgres.DATABASE_URL}}` and `AUTH_SECRET` on the service.
The build itself needs no secrets — connections are created lazily.

---

## Known limitations

- **Auth is demo-scoped.** Signed cookies, no passwords, and `/login`
  enumerates accounts. Fine because there are no credentials to protect;
  it is not production auth.
- **One instance only**, as above.
- Managers can't clock staff in — clocking is self-service.
- Notification preferences cover email simulation and muted types, but there is
  no per-type UI.
- `requireRole` and the session-guarded services can't be unit-tested, because
  they read the session from request context. They're verified over HTTP; the
  rules beneath them are unit-tested.
- `npm audit` reports a moderate advisory against `esbuild`, reachable only
  through `drizzle-kit`, which is a production dependency here because it runs
  the pre-deploy migration. It concerns esbuild's dev server, which this project
  never starts.
