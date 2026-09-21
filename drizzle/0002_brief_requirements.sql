CREATE TYPE "public"."swap_request_kind" AS ENUM('swap', 'drop');--> statement-breakpoint
CREATE TABLE "compliance_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"rule" text NOT NULL,
	"reason" text NOT NULL,
	"overridden_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid,
	"staff_id" uuid NOT NULL,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"staff_id" uuid PRIMARY KEY NOT NULL,
	"email_simulation_enabled" boolean DEFAULT false NOT NULL,
	"muted_types" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"name" text PRIMARY KEY NOT NULL,
	"description" text
);
--> statement-breakpoint
ALTER TABLE "swap_requests" DROP CONSTRAINT "swap_requests_requested_to_staff_id_fk";
--> statement-breakpoint
ALTER TABLE "swap_requests" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "swap_requests" ALTER COLUMN "status" SET DEFAULT 'open'::text;--> statement-breakpoint
DROP TYPE "public"."swap_request_status";--> statement-breakpoint
CREATE TYPE "public"."swap_request_status" AS ENUM('open', 'peer_accepted', 'approved', 'rejected', 'cancelled', 'expired');--> statement-breakpoint
ALTER TABLE "swap_requests" ALTER COLUMN "status" SET DEFAULT 'open'::"public"."swap_request_status";--> statement-breakpoint
ALTER TABLE "swap_requests" ALTER COLUMN "status" SET DATA TYPE "public"."swap_request_status" USING "status"::"public"."swap_request_status";--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "clocked_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "clocked_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "location_id" uuid;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "edit_cutoff_hours" integer DEFAULT 48 NOT NULL;--> statement-breakpoint
ALTER TABLE "swap_requests" ADD COLUMN "kind" "swap_request_kind" DEFAULT 'swap' NOT NULL;--> statement-breakpoint
ALTER TABLE "swap_requests" ADD COLUMN "target_assignment_id" uuid;--> statement-breakpoint
ALTER TABLE "swap_requests" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "swap_requests" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "swap_requests" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "compliance_overrides" ADD CONSTRAINT "compliance_overrides_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_overrides" ADD CONSTRAINT "compliance_overrides_overridden_by_staff_id_fk" FOREIGN KEY ("overridden_by") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "compliance_overrides_assignment_idx" ON "compliance_overrides" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "email_log_staff_idx" ON "email_log" USING btree ("staff_id","sent_at");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_required_skill_skills_name_fk" FOREIGN KEY ("required_skill") REFERENCES "public"."skills"("name") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "staff_skills" ADD CONSTRAINT "staff_skills_skill_skills_name_fk" FOREIGN KEY ("skill") REFERENCES "public"."skills"("name") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_target_assignment_id_assignments_id_fk" FOREIGN KEY ("target_assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_approved_by_staff_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_requested_to_staff_id_fk" FOREIGN KEY ("requested_to") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignments_on_duty_idx" ON "assignments" USING btree ("clocked_in_at");--> statement-breakpoint
CREATE INDEX "audit_log_location_idx" ON "audit_log" USING btree ("location_id","created_at");--> statement-breakpoint
CREATE INDEX "swap_requests_requester_open_idx" ON "swap_requests" USING btree ("requested_by","status");--> statement-breakpoint
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_shape" CHECK ((
        "swap_requests"."kind" = 'swap'
        AND "swap_requests"."requested_to" IS NOT NULL
        AND "swap_requests"."target_assignment_id" IS NOT NULL
        AND "swap_requests"."expires_at" IS NULL
      ) OR (
        "swap_requests"."kind" = 'drop'
        AND "swap_requests"."requested_to" IS NULL
        AND "swap_requests"."target_assignment_id" IS NULL
        AND "swap_requests"."expires_at" IS NOT NULL
      ));