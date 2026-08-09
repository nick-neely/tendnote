CREATE TYPE "public"."household_invitation_delivery_status" AS ENUM('queued', 'sending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."household_invitation_state" AS ENUM('pending', 'accepted', 'declined', 'canceled', 'expired');--> statement-breakpoint
CREATE TABLE "household_invitation_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invitation_id" uuid NOT NULL,
	"status" "household_invitation_delivery_status" DEFAULT 'queued' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"provider_message_id" text,
	"failure_class" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"invited_by_user_id" text NOT NULL,
	"role" "household_role" DEFAULT 'member' NOT NULL,
	"email" text NOT NULL,
	"normalized_email" text NOT NULL,
	"secret_digest" text NOT NULL,
	"state" "household_invitation_state" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_sent_at" timestamp with time zone,
	"resend_count" integer DEFAULT 0 NOT NULL,
	"accepted_by_user_id" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "household_invitation_deliveries" ADD CONSTRAINT "household_invitation_deliveries_invitation_id_household_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."household_invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_invitations" ADD CONSTRAINT "household_invitations_household_id_household_workspaces_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_invitations" ADD CONSTRAINT "household_invitations_invited_by_user_id_user_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_invitations" ADD CONSTRAINT "household_invitations_accepted_by_user_id_user_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "household_invitation_deliveries_invitation_idx" ON "household_invitation_deliveries" USING btree ("invitation_id");--> statement-breakpoint
CREATE INDEX "household_invitation_deliveries_status_idx" ON "household_invitation_deliveries" USING btree ("status","requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "household_invitations_secret_digest_idx" ON "household_invitations" USING btree ("secret_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "household_invitations_live_recipient_idx" ON "household_invitations" USING btree ("household_id","normalized_email") WHERE state = 'pending';--> statement-breakpoint
CREATE INDEX "household_invitations_household_state_idx" ON "household_invitations" USING btree ("household_id","state");--> statement-breakpoint
CREATE INDEX "household_invitations_recipient_state_idx" ON "household_invitations" USING btree ("normalized_email","state");