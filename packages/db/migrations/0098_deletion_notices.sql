CREATE TYPE "public"."account_deletion_reason" AS ENUM('owner_request', 'retention_deadline');--> statement-breakpoint
CREATE TYPE "public"."deletion_notice_stage" AS ENUM('day_0', 'day_60', 'day_83');--> statement-breakpoint
CREATE TABLE "deletion_notices" (
	"user_id" text PRIMARY KEY NOT NULL,
	"retention_deadline" timestamp with time zone NOT NULL,
	"stage" "deletion_notice_stage",
	"sent_at" timestamp with time zone,
	"attempted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "account_deletion_intents" ADD COLUMN "reason" "account_deletion_reason" DEFAULT 'owner_request' NOT NULL;--> statement-breakpoint
ALTER TABLE "deletion_notices" ADD CONSTRAINT "deletion_notices_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;