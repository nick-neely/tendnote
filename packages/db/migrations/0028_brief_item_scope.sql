ALTER TABLE "brief_items" ADD COLUMN "scope" "privacy_scope" DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "brief_items" ADD COLUMN "household_id" uuid;--> statement-breakpoint
ALTER TABLE "brief_items" ADD CONSTRAINT "brief_items_household_id_household_workspaces_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brief_items_household_id_idx" ON "brief_items" USING btree ("household_id");