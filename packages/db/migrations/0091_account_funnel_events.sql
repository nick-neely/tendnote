CREATE TYPE "public"."account_funnel_stage" AS ENUM('signup_completed', 'checkout_started', 'payment_confirmed', 'paid_access_granted', 'first_person_created', 'first_memory_confirmed', 'first_followup_scheduled', 'first_grounded_eve_answer', 'first_value_reached');--> statement-breakpoint
CREATE TABLE "account_funnel_events" (
	"funnel_account_id" uuid NOT NULL,
	"stage" "account_funnel_stage" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_funnel_events_pkey" PRIMARY KEY("funnel_account_id","stage")
);
--> statement-breakpoint
CREATE TABLE "funnel_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"region_eligible" boolean DEFAULT true NOT NULL,
	CONSTRAINT "funnel_accounts_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "access_profiles" ADD COLUMN "telemetry_opted_out" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "account_funnel_events" ADD CONSTRAINT "account_funnel_events_funnel_account_id_funnel_accounts_id_fk" FOREIGN KEY ("funnel_account_id") REFERENCES "public"."funnel_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_accounts" ADD CONSTRAINT "funnel_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_funnel_events_occurred_at_idx" ON "account_funnel_events" USING btree ("occurred_at");