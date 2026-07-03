ALTER TYPE "visibility_record_kind" ADD VALUE 'followup';--> statement-breakpoint
ALTER TABLE "followups" ADD COLUMN "household_id" uuid;--> statement-breakpoint
ALTER TABLE "followups" ADD COLUMN "scope" "privacy_scope" DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "followups" ADD COLUMN "created_by_user_id" text;--> statement-breakpoint
ALTER TABLE "followups" ADD COLUMN "last_actor_user_id" text;--> statement-breakpoint
ALTER TABLE "followups" ADD CONSTRAINT "followups_household_id_household_workspaces_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followups" ADD CONSTRAINT "followups_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followups" ADD CONSTRAINT "followups_last_actor_user_id_user_id_fk" FOREIGN KEY ("last_actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "followups_household_scope_idx" ON "followups" USING btree ("household_id","scope");
