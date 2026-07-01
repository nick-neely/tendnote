CREATE TYPE "public"."gmail_draft_action_kind" AS ENUM('create', 'update');--> statement-breakpoint
CREATE TYPE "public"."gmail_draft_action_status" AS ENUM('succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."gmail_draft_recipient_source" AS ENUM('contact_method', 'manual_entry');--> statement-breakpoint
CREATE TABLE "gmail_draft_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"message_draft_id" uuid NOT NULL,
	"provider_key" text NOT NULL,
	"capability_key" text NOT NULL,
	"kind" "gmail_draft_action_kind" NOT NULL,
	"status" "gmail_draft_action_status" NOT NULL,
	"subject" text NOT NULL,
	"recipient_email" text NOT NULL,
	"recipient_source" "gmail_draft_recipient_source" NOT NULL,
	"recipient_contact_method_id" uuid,
	"gmail_draft_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"idempotency_key" text NOT NULL,
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gmail_draft_actions" ADD CONSTRAINT "gmail_draft_actions_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_draft_actions" ADD CONSTRAINT "gmail_draft_actions_message_draft_id_message_drafts_id_fk" FOREIGN KEY ("message_draft_id") REFERENCES "public"."message_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gmail_draft_actions_owner_user_id_idx" ON "gmail_draft_actions" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "gmail_draft_actions_message_draft_id_idx" ON "gmail_draft_actions" USING btree ("message_draft_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gmail_draft_actions_owner_idempotency_idx" ON "gmail_draft_actions" USING btree ("owner_user_id","idempotency_key");