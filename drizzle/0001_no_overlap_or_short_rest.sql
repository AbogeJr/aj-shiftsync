-- One constraint enforcing two rules: a staff member may not be double booked,
-- and may not start a shift within 10 hours of finishing the last one.
--
-- Padding each row's range on the end side by the rest period makes two padded
-- ranges intersect exactly when the shifts overlap OR the gap between them is
-- under 10 hours: for non-overlapping shifts A then B, the ranges intersect iff
-- B.starts_at < A.ends_at + 10h, which is the definition of insufficient rest.
-- Bounds are half-open, so a gap of exactly 10 hours is legal.
--
-- This lives in the database because a SELECT-then-INSERT check does not
-- survive concurrency: two requests can both read "no conflict" before either
-- writes. The constraint is evaluated by the index under proper locking, so one
-- writer blocks and then fails, whatever is doing the writing.
--
-- btree_gist is required to compare staff_id (uuid) with = inside a GiST index.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- Index expressions must be IMMUTABLE, and `timestamptz + interval` is only
-- STABLE, because adding a day-or-larger interval depends on the session
-- timezone (a calendar day is 23 or 25 hours across a DST transition). Writing
-- the expression inline fails with "functions in index expression must be
-- marked IMMUTABLE".
--
-- An HOURS-only interval has no such dependency - an hour is always 3600
-- seconds - so declaring this wrapper IMMUTABLE is accurate rather than a
-- loophole. It stays accurate only while the interval is in hours; do not
-- change it to days. Changing the rest period means dropping the constraint,
-- replacing this function, and re-adding it, which rebuilds the index.
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

-- Partial: cancelled and declined assignments stop occupying the staff member's
-- time and may sit on top of an active one.
ALTER TABLE "assignments" ADD CONSTRAINT "no_overlap_or_short_rest"
  EXCLUDE USING gist (
    "staff_id" WITH =,
    shiftsync_rest_window("starts_at", "ends_at") WITH &&
  ) WHERE ("status" = 'active');
