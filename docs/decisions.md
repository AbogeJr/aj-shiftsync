# Decisions and assumptions

The brief leaves several questions deliberately unspecified. These are the
positions taken, with the reasoning, so a reviewer can disagree with the
decision rather than guess at the intent.

---

## 1. De-certification and historical data

**A certification is revoked, never deleted, and past assignments stand.**

`certifications` is interval-scoped — validity is `[effective_from, revoked_at)`
— so removing someone from a location sets `revoked_at` and leaves the row.
Eligibility is evaluated against the shift's start time, not against "now".

- **Past assignments are untouched.** They were valid when made. A schedule
  history that rewrites itself is worthless for dispute resolution, which is
  most of what an audit trail is for.
- **Future assignments are flagged, not cancelled.** Silently removing someone
  from a published shift leaves it uncovered and tells no one. The manager sees
  a compliance warning and decides.

The cost: a manager can ignore the warning and let an uncertified person work.
That is a deliberate trade — the system surfaces the problem and leaves the
judgement with a human, rather than creating a coverage hole on its own.

## 2. Desired hours vs. availability windows

**Availability is a hard constraint. Desired hours is a soft target.**

Nobody is scheduled outside their availability. Anybody can be scheduled above
or below `desired_weekly_hours`, and the gap feeds the fairness report instead
of blocking the assignment.

Treating desired hours as a cap would make most weeks unsolvable — the sum of
everyone's preferred hours rarely matches the hours a restaurant actually needs
covered. Desired hours answers "is this distribution fair?", not "is this
assignment legal?".

## 3. Consecutive days: does a 1-hour shift count like an 11-hour one?

**Yes. A day worked is a day worked.**

The 6th- and 7th-consecutive-day rules exist to protect rest. A one-hour shift
still requires travel, still occupies the day, and still breaks a run of days
off — so it counts.

"Day" is the **local calendar date in the staff member's own timezone**, not
UTC. An overnight shift counts as the day it starts, so 23:00–03:00 is one day,
not two.

The rejected alternative was a minimum-hours threshold (e.g. only shifts over 4
hours count). It invites gaming: a run of deliberately short shifts would evade
a rule designed to prevent exactly that pattern.

The cost: a 1-hour shift on a 7th consecutive day requires a documented manager
override. That is the intended friction.

## 4. A shift edited after swap approval, before it occurs

**Approval applies the swap immediately, so a later edit is just a normal edit.**

Once a manager approves, the assignment rows have already changed hands. There
is no pending state left to invalidate, so an edit afterwards behaves like any
other shift edit and notifies whoever now holds the assignment.

This is the deliberate counterpart to the rule the brief *does* specify: while a
swap is **pending**, editing the shift auto-cancels the request and notifies
both parties. The distinction is whether an approval has been applied yet.

If the edit moves the times far enough to break the new holder's rest gap or
double-book them, the `no_overlap_or_short_rest` constraint rejects the write
and the manager has to resolve it. The database refuses to produce an illegal
schedule regardless of which path the edit arrived by.

## 5. A location spanning a timezone boundary

**A location has exactly one IANA timezone: the one its payroll and labour law
use.**

Geography is not modelled. A restaurant near a state line still files under one
jurisdiction, and that jurisdiction decides when "the 1st of the month" and "a
calendar day" begin — which is what overtime and consecutive-day rules depend
on.

Staff carry their own `availability_tz` independently of any location, so
somebody living across the line sets availability in their own zone and it
resolves correctly against shifts at either location.

Modelling a location as spanning two zones would make "a 9am shift" ambiguous
with no principled way to resolve it.

---

# Decisions the brief did not raise

**Exactly 10 hours of rest is legal.** The rest constraint uses half-open
ranges, so a gap of precisely 10 hours is compliant rather than a violation.
"Minimum 10 hours between shifts" reads as a floor, not an exclusive bound.

**Overtime pays time-and-a-half.** The brief sets the 40-hour threshold but
never says what an overtime hour costs. `OVERTIME_MULTIPLIER` is the US FLSA
default of 1.5, in one place, so a group under a different rule changes it once.
The overview reports the *premium* — the 0.5x above straight time — because that
is the avoidable number a manager can act on, with total overtime hours beside
it. Somebody with no rate on file contributes hours but no money: reporting
their overtime as $0 would be a lie, so the hours still count and the cost does
not.

**Premium shifts are derived, never stored.** "Friday/Saturday evening" is
computed from `shifts.starts_at` in the location's timezone at query time. A
stored boolean would drift the moment a shift moved, and deriving it stays
correct across DST for free. The same applies to fairness scores, overtime
projections and consecutive-day counts — all computed on read.

**Skills are a closed set.** `staff_skills.skill` and `shifts.required_skill`
reference a `skills` table rather than being free text. A typo in free text
silently makes someone ineligible, which is indistinguishable from a
correctly-enforced constraint and very hard to debug.

**Real-time fan-out is in-process and assumes one instance.** The SSE stream is
treated as a cache-invalidation hint rather than a data channel: clients refetch
on every connect *and reconnect*, so an event missed during a disconnect costs a
redundant query instead of a stale roster. Scaling past one instance means
moving to Postgres `LISTEN`/`NOTIFY`, which is confined to `lib/realtime/bus.ts`.

**Authentication is demo-scoped.** Signed cookies over HMAC-SHA256, three
one-click seeded accounts, no passwords. Chosen so a reviewer can switch roles
instantly. See the README for what makes it unsuitable for production.

---

# Known limitations

Maintained in the [README](../README.md#known-limitations), so there is one list
rather than two that drift apart.
