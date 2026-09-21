CREATE TYPE "public"."assignment_status" AS ENUM('active', 'cancelled', 'declined');--> statement-breakpoint
CREATE TYPE "public"."availability_exception_kind" AS ENUM('available', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('staff', 'manager', 'admin');--> statement-breakpoint
CREATE TYPE "public"."swap_request_status" AS ENUM('open', 'accepted', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"status" "assignment_status" DEFAULT 'active' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignments_time_order" CHECK ("assignments"."ends_at" > "assignments"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_staff_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "availability_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"date" date NOT NULL,
	"start_local" time NOT NULL,
	"end_local" time NOT NULL,
	"kind" "availability_exception_kind" NOT NULL,
	CONSTRAINT "availability_exceptions_local_order" CHECK ("availability_exceptions"."end_local" > "availability_exceptions"."start_local")
);
--> statement-breakpoint
CREATE TABLE "availability_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_local" time NOT NULL,
	"end_local" time NOT NULL,
	CONSTRAINT "availability_rules_weekday_range" CHECK ("availability_rules"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "availability_rules_local_order" CHECK ("availability_rules"."end_local" > "availability_rules"."start_local")
);
--> statement-breakpoint
CREATE TABLE "certifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "certifications_revoked_after_effective" CHECK ("certifications"."revoked_at" IS NULL OR "certifications"."revoked_at" > "certifications"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manager_locations" (
	"staff_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	CONSTRAINT "manager_locations_staff_id_location_id_pk" PRIMARY KEY("staff_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"required_skill" text,
	"headcount" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shifts_time_order" CHECK ("shifts"."ends_at" > "shifts"."starts_at"),
	CONSTRAINT "shifts_headcount_positive" CHECK ("shifts"."headcount" > 0)
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" "staff_role" DEFAULT 'staff' NOT NULL,
	"desired_weekly_hours" integer DEFAULT 0 NOT NULL,
	"availability_tz" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_desired_weekly_hours_sane" CHECK ("staff"."desired_weekly_hours" >= 0 AND "staff"."desired_weekly_hours" <= 168)
);
--> statement-breakpoint
CREATE TABLE "staff_skills" (
	"staff_id" uuid NOT NULL,
	"skill" text NOT NULL,
	CONSTRAINT "staff_skills_staff_id_skill_pk" PRIMARY KEY("staff_id","skill")
);
--> statement-breakpoint
CREATE TABLE "swap_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_to" uuid,
	"status" "swap_request_status" DEFAULT 'open' NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_staff_id_staff_id_fk" FOREIGN KEY ("actor_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_locations" ADD CONSTRAINT "manager_locations_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_locations" ADD CONSTRAINT "manager_locations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_skills" ADD CONSTRAINT "staff_skills_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_requested_by_staff_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_requested_to_staff_id_fk" FOREIGN KEY ("requested_to") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignments_shift_idx" ON "assignments" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "assignments_staff_starts_at_idx" ON "assignments" USING btree ("staff_id","starts_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "availability_exceptions_staff_date_idx" ON "availability_exceptions" USING btree ("staff_id","date");--> statement-breakpoint
CREATE INDEX "availability_rules_staff_idx" ON "availability_rules" USING btree ("staff_id","weekday");--> statement-breakpoint
CREATE INDEX "certifications_staff_location_idx" ON "certifications" USING btree ("staff_id","location_id");--> statement-breakpoint
CREATE INDEX "notifications_staff_unread_idx" ON "notifications" USING btree ("staff_id","created_at");--> statement-breakpoint
CREATE INDEX "shifts_location_starts_at_idx" ON "shifts" USING btree ("location_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_email_key" ON "staff" USING btree ("email");--> statement-breakpoint
CREATE INDEX "staff_skills_skill_idx" ON "staff_skills" USING btree ("skill");--> statement-breakpoint
CREATE INDEX "swap_requests_assignment_idx" ON "swap_requests" USING btree ("assignment_id","status");