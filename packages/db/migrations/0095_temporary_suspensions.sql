CREATE TABLE "suspension_deadline_renewals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suspension_id" uuid NOT NULL,
	"review_deadline" timestamp with time zone NOT NULL,
	"renewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "temporary_suspensions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"reason" text NOT NULL,
	"suspended_at" timestamp with time zone DEFAULT now() NOT NULL,
	"review_deadline" timestamp with time zone NOT NULL,
	"lifted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "suspension_deadline_renewals" ADD CONSTRAINT "suspension_deadline_renewals_suspension_id_temporary_suspensions_id_fk" FOREIGN KEY ("suspension_id") REFERENCES "public"."temporary_suspensions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temporary_suspensions" ADD CONSTRAINT "temporary_suspensions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "suspension_deadline_renewals_suspension_idx" ON "suspension_deadline_renewals" USING btree ("suspension_id");--> statement-breakpoint
CREATE INDEX "temporary_suspensions_user_idx" ON "temporary_suspensions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "temporary_suspensions_one_open_idx" ON "temporary_suspensions" USING btree ("user_id") WHERE "temporary_suspensions"."lifted_at" is null;