CREATE TYPE "public"."household_status" AS ENUM('active', 'dissolved');--> statement-breakpoint
CREATE TABLE "household_dissolution_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "household_workspaces_owner_user_id_idx";--> statement-breakpoint
ALTER TABLE "household_memberships" ADD COLUMN "pending_role" "household_role";--> statement-breakpoint
ALTER TABLE "household_memberships" ADD COLUMN "pending_role_offered_by_user_id" text;--> statement-breakpoint
ALTER TABLE "household_memberships" ADD COLUMN "pending_role_offered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "household_workspaces" ADD COLUMN "status" "household_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "household_workspaces" ADD COLUMN "dissolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "household_dissolution_confirmations" ADD CONSTRAINT "household_dissolution_confirmations_household_id_household_workspaces_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_dissolution_confirmations" ADD CONSTRAINT "household_dissolution_confirmations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "household_dissolution_confirmations_household_user_idx" ON "household_dissolution_confirmations" USING btree ("household_id","user_id");--> statement-breakpoint
ALTER TABLE "household_memberships" ADD CONSTRAINT "household_memberships_pending_role_offered_by_user_id_user_id_fk" FOREIGN KEY ("pending_role_offered_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "household_record_shares_shared_by_idx" ON "household_record_shares" USING btree ("household_id","shared_by_user_id");--> statement-breakpoint
CREATE INDEX "household_workspaces_status_dissolved_at_idx" ON "household_workspaces" USING btree ("status","dissolved_at");--> statement-breakpoint
CREATE INDEX "household_workspaces_owner_user_id_idx" ON "household_workspaces" USING btree ("owner_user_id");