CREATE TABLE "birthday_gift_planning_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"local_date" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"summary" text NOT NULL,
	"sensitivity" text DEFAULT 'normal' NOT NULL,
	"birthday_keys" text[] NOT NULL,
	"proposals" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "birthday_gift_planning_artifacts_sensitivity_check" CHECK ("birthday_gift_planning_artifacts"."sensitivity" in ('normal', 'sensitive', 'restricted'))
);
--> statement-breakpoint
CREATE TABLE "birthday_gift_planning_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"timezone" text NOT NULL,
	"run_at_minute" integer DEFAULT 540 NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "birthday_gift_planning_artifacts" ADD CONSTRAINT "birthday_gift_planning_artifacts_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birthday_gift_planning_schedules" ADD CONSTRAINT "birthday_gift_planning_schedules_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "birthday_gift_planning_owner_date_current_idx" ON "birthday_gift_planning_artifacts" USING btree ("owner_user_id","local_date");--> statement-breakpoint
CREATE INDEX "birthday_gift_planning_owner_created_idx" ON "birthday_gift_planning_artifacts" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "birthday_gift_planning_schedules_owner_idx" ON "birthday_gift_planning_schedules" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "birthday_gift_planning_schedules_due_idx" ON "birthday_gift_planning_schedules" USING btree ("next_run_at") WHERE "birthday_gift_planning_schedules"."enabled";