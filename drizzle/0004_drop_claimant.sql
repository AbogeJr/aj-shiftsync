ALTER TABLE "swap_requests" DROP CONSTRAINT "swap_requests_shape";--> statement-breakpoint
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_shape" CHECK ((
        "swap_requests"."kind" = 'swap'
        AND "swap_requests"."requested_to" IS NOT NULL
        AND "swap_requests"."target_assignment_id" IS NOT NULL
        AND "swap_requests"."expires_at" IS NULL
      ) OR (
        "swap_requests"."kind" = 'drop'
        AND "swap_requests"."target_assignment_id" IS NULL
        AND "swap_requests"."expires_at" IS NOT NULL
      ));