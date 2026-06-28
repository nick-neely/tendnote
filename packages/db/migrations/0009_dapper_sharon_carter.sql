CREATE TABLE "brief_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"cadence" "brief_cadence" NOT NULL,
	"timezone" text NOT NULL,
	"run_at_minute" integer NOT NULL,
	"weekday" integer,
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
ALTER TABLE "brief_schedules" ADD CONSTRAINT "brief_schedules_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brief_schedules_owner_cadence_idx" ON "brief_schedules" USING btree ("owner_user_id","cadence");--> statement-breakpoint
CREATE INDEX "brief_schedules_due_idx" ON "brief_schedules" USING btree ("next_run_at") WHERE "brief_schedules"."enabled";