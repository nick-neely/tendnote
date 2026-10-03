CREATE TABLE "admission_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"block_kind" text NOT NULL,
	"event" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admission_exceptions_block_event_unique" UNIQUE("block_kind","event")
);
--> statement-breakpoint
CREATE TABLE "refund_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"stripe_subscription_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"payment_intent_id" text NOT NULL,
	"amount" integer NOT NULL,
	"instrument" text DEFAULT 'card' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stripe_refund_id" text,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "refund_records_stripe_refund_id_unique" UNIQUE("stripe_refund_id")
);
--> statement-breakpoint
CREATE TABLE "stripe_disputes" (
	"stripe_dispute_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"stripe_subscription_id" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"renewal_stopped" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admission_exceptions" ADD CONSTRAINT "admission_exceptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_records" ADD CONSTRAINT "refund_records_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_disputes" ADD CONSTRAINT "stripe_disputes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refund_records_subscription_idx" ON "refund_records" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE INDEX "refund_records_invoice_idx" ON "refund_records" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "refund_records_payment_intent_idx" ON "refund_records" USING btree ("payment_intent_id");--> statement-breakpoint
CREATE INDEX "stripe_disputes_subscription_idx" ON "stripe_disputes" USING btree ("stripe_subscription_id");