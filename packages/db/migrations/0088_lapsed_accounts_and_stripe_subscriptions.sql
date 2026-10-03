CREATE TABLE "stripe_subscriptions" (
	"stripe_subscription_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"cancel_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_profiles" ADD COLUMN "retention_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD COLUMN "paid_access_subscription_id" text;--> statement-breakpoint
ALTER TABLE "stripe_subscriptions" ADD CONSTRAINT "stripe_subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stripe_subscriptions_user_idx" ON "stripe_subscriptions" USING btree ("user_id");