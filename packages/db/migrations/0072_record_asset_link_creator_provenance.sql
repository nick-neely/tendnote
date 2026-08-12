ALTER TABLE "general_action_assets" DROP CONSTRAINT "general_action_assets_owner_user_id_user_id_fk";
--> statement-breakpoint
DROP INDEX "general_action_assets_owner_idx";--> statement-breakpoint
ALTER TABLE "general_action_assets" RENAME COLUMN "owner_user_id" TO "created_by_user_id";--> statement-breakpoint
ALTER TABLE "general_action_assets" ALTER COLUMN "created_by_user_id" DROP NOT NULL;--> statement-breakpoint
-- The legacy column was populated inconsistently: some writers stored the
-- association actor, while others copied a parent record's operational owner
-- key. None of those values can be asserted as creator history after the rename.
UPDATE "general_action_assets" SET "created_by_user_id" = NULL;--> statement-breakpoint
ALTER TABLE "general_action_assets" ADD CONSTRAINT "general_action_assets_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "general_action_assets_creator_idx" ON "general_action_assets" USING btree ("created_by_user_id");
