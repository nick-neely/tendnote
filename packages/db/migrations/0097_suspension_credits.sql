CREATE TABLE "suspension_credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"suspension_id" uuid,
	"termination_id" uuid,
	"stripe_subscription_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"invoice_line_item_id" text NOT NULL,
	"payment_intent_id" text,
	"suspended_amount" integer NOT NULL,
	"remainder_amount" integer NOT NULL,
	"amount" integer NOT NULL,
	"instrument" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stripe_credit_note_id" text,
	"stripe_refund_id" text,
	CONSTRAINT "suspension_credits_stripe_credit_note_id_unique" UNIQUE("stripe_credit_note_id"),
	CONSTRAINT "suspension_credits_stripe_refund_id_unique" UNIQUE("stripe_refund_id")
);
--> statement-breakpoint
ALTER TABLE "suspension_credits" ADD CONSTRAINT "suspension_credits_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suspension_credits" ADD CONSTRAINT "suspension_credits_suspension_id_temporary_suspensions_id_fk" FOREIGN KEY ("suspension_id") REFERENCES "public"."temporary_suspensions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suspension_credits" ADD CONSTRAINT "suspension_credits_termination_id_terminations_id_fk" FOREIGN KEY ("termination_id") REFERENCES "public"."terminations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "suspension_credits_user_idx" ON "suspension_credits" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "suspension_credits_payment_intent_idx" ON "suspension_credits" USING btree ("payment_intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suspension_credits_lift_invoice_idx" ON "suspension_credits" USING btree ("suspension_id","invoice_id") WHERE "suspension_credits"."termination_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "suspension_credits_termination_invoice_idx" ON "suspension_credits" USING btree ("termination_id","invoice_id") WHERE "suspension_credits"."termination_id" is not null;