CREATE TABLE "account_deletion_intents" (
	"user_id" text PRIMARY KEY NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"journaled_at" timestamp with time zone,
	"attempted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "account_deletion_intents" ADD CONSTRAINT "account_deletion_intents_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_deletion_intents_retry_order_idx" ON "account_deletion_intents" USING btree ("attempted_at","requested_at");