CREATE TABLE "terminations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"reason" text NOT NULL,
	"terminated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retention_deadline" timestamp with time zone NOT NULL,
	"suspension_id" uuid,
	"stripe_subscription_id" text,
	CONSTRAINT "terminations_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "terminations" ADD CONSTRAINT "terminations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminations" ADD CONSTRAINT "terminations_suspension_id_temporary_suspensions_id_fk" FOREIGN KEY ("suspension_id") REFERENCES "public"."temporary_suspensions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "terminations_suspension_idx" ON "terminations" USING btree ("suspension_id");