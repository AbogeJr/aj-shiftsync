# Decisions and assumptions

Where the requirements were silent or ambiguous, this is the position taken and
why.

## De-certification does not rewrite history

A certification is revoked, never deleted: validity is the interval
`[effective_from, revoked_at)`, and eligibility is judged against the shift's
start time, not against now.

Past assignments stand, because they were valid when made and a history that
rewrites itself is useless for settling a dispute. Future assignments are
flagged rather than cancelled, because silently removing someone leaves a shift
uncovered and tells nobody. The cost is that a manager can ignore the warning.

## Availability is a hard limit, desired hours is a target

Nobody is scheduled outside their availability. Anybody can be scheduled above
or below their desired weekly hours, and the gap feeds the fairness report
instead of blocking the assignment.

Treating desired hours as a cap would make most weeks unsolvable: the sum of
everyone's preferences rarely matches the hours a restaurant needs covered.

## A short shift still counts as a day worked

The 6th and 7th consecutive day rules exist to protect rest, and a one-hour
shift still occupies the day. A minimum-hours threshold would invite a run of
deliberately short shifts, which is the pattern the rule exists to prevent.

"Day" means the local calendar date in the staff member's own timezone. An
overnight shift counts as the day it starts.

## A swap edited after approval is just an edit

Approval applies the swap immediately, so there is no pending state left to
invalidate and a later edit behaves like any other. While a swap is still
pending, editing the shift cancels the request and notifies both parties.

If an edit would double-book the new holder or break their rest gap, the
constraint rejects it regardless of which path it arrived by.

## A location has exactly one timezone

The one its payroll and labour law use. Geography is not modelled: a restaurant
near a state line still files under one jurisdiction, and that jurisdiction
decides when a calendar day begins, which is what overtime and consecutive-day
counting depend on.

Staff carry their own `availability_tz` independently, so somebody living across
the line sets availability in their own zone and it resolves correctly against
either location.

## Smaller calls

**Exactly 10 hours of rest is legal.** The constraint uses half-open ranges, so
a gap of precisely 10 hours is compliant. "Minimum 10 hours" reads as a floor.

**Overtime pays time-and-a-half.** `OVERTIME_MULTIPLIER` is the US FLSA default,
in one place. The overview reports the premium above straight time, because that
is the avoidable number. Somebody with no rate on file contributes hours but no
money rather than a misleading zero.

**Premium shifts are derived, never stored.** Friday and Saturday from 17:00, in
the location's own timezone, computed at query time. A stored flag would drift
the moment a shift moved. The same goes for fairness scores, overtime
projections and consecutive-day counts.

**Fairness is measured against hours worked, not an equal split.** Somebody on
eight hours a week should not expect as many Friday nights as somebody on forty.
The score is the index of dissimilarity, which reads directly as "this many
premium shifts are in the wrong hands".

**Overtime is attributed chronologically.** Removing any of a week's shifts
lowers the total equally, so "which shift caused it" has no single answer.
Accumulating in the order worked names the shift that crosses the threshold,
which is usually one that has not happened yet and can still be changed.

**Skills are a closed set.** A typo in free text silently makes someone
ineligible, which is indistinguishable from a correctly enforced constraint and
very hard to debug.

**Real-time fan-out is in-process** and assumes one instance. See
[architecture.md](architecture.md).

**Authentication is demo-scoped.** Signed cookies over HMAC-SHA256, one-click
accounts, no passwords, so a reader can switch roles instantly. The README says
what makes it unsuitable for production.

---

Known limitations are in the [README](../README.md#known-limitations).
