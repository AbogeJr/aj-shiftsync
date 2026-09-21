-- One constraint enforcing two rules at once: a staff member may not be double
-- booked, and may not start a shift within 10 hours of finishing the last one.
--
-- THE TRICK
-- ---------
-- An exclusion constraint rejects a row when some pair of rows is mutually
-- "conflicting" under the given operators. Compare staff_id with = and the
-- worked interval with && (ranges overlap) and you get double-booking
-- protection only. But pad each row's range on the END side by the rest period:
--
--     [ starts_at , ends_at + 10h )
--
-- Two padded ranges intersect exactly when the shifts overlap OR the gap
-- between them is under 10 hours. Proof for two non-overlapping shifts A then
-- B: A's padded range reaches A.ends_at + 10h, and B's begins at B.starts_at,
-- so they intersect iff B.starts_at < A.ends_at + 10h - which is the definition
-- of "less than 10 hours of rest". Padding one side only is what makes this
-- symmetric and non-double-counting; padding both sides would demand 20 hours.
--
-- Bounds are '[)' (half-open) so a gap of exactly 10 hours is legal: the ranges
-- touch without intersecting. Exactly-10h is compliant rest, not a violation.
--
-- Why this rather than a SELECT-then-INSERT check in application code: two
-- concurrent requests can both run the SELECT, both see no conflict, and both
-- INSERT. The exclusion constraint is evaluated by the index under proper
-- locking, so one of the two writers blocks and then fails. This is the only
-- version of the rule that survives concurrency, and it holds no matter what
-- writes to the table - route handler, backfill, or psql.
--
-- btree_gist is required because staff_id (uuid) is compared with a plain btree
-- operator (=) inside a GiST index, which core GiST cannot do on its own.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- Postgres requires every expression in an index to be IMMUTABLE, and the
-- `timestamptz + interval` operator is only STABLE: adding a DAY-or-larger
-- interval depends on the session TimeZone, because a calendar day is 23 or 25
-- hours across a DST transition. Writing the expression inline therefore fails
-- with "functions in index expression must be marked IMMUTABLE".
--
-- An HOURS-only interval has no such dependency. timestamptz is an absolute
-- instant and an hour is always exactly 3600 seconds, so this addition produces
-- the same result under every session timezone. Declaring this wrapper
-- IMMUTABLE is therefore accurate, not a loophole - but it stays accurate only
-- while the interval is expressed in hours. Do not change it to days.
--
-- Changing the rest period means dropping the constraint, replacing this
-- function, and re-adding the constraint (which rebuilds the index).
CREATE OR REPLACE FUNCTION shiftsync_rest_window(starts_at timestamptz, ends_at timestamptz)
RETURNS tstzrange
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$
  SELECT tstzrange(starts_at, ends_at + interval '10 hours', '[)')
$$;
--> statement-breakpoint

-- WHERE (status = 'active') makes this a partial constraint: cancelled and
-- declined assignments stop occupying the staff member's time, and a cancelled
-- row can sit on top of an active one without conflict.
ALTER TABLE "assignments" ADD CONSTRAINT "no_overlap_or_short_rest"
  EXCLUDE USING gist (
    "staff_id" WITH =,
    shiftsync_rest_window("starts_at", "ends_at") WITH &&
  ) WHERE ("status" = 'active');
