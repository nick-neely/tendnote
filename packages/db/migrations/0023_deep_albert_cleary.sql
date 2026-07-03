CREATE TYPE "public"."visibility_record_kind" AS ENUM('memory', 'source_record');--> statement-breakpoint
CREATE TABLE "household_record_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"record_kind" "visibility_record_kind" NOT NULL,
	"record_id" uuid NOT NULL,
	"shared_with_user_id" text NOT NULL,
	"shared_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "household_id" uuid;--> statement-breakpoint
ALTER TABLE "source_records" ADD COLUMN "household_id" uuid;--> statement-breakpoint
ALTER TABLE "household_record_shares" ADD CONSTRAINT "household_record_shares_household_id_household_workspaces_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_record_shares" ADD CONSTRAINT "household_record_shares_shared_with_user_id_user_id_fk" FOREIGN KEY ("shared_with_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_record_shares" ADD CONSTRAINT "household_record_shares_shared_by_user_id_user_id_fk" FOREIGN KEY ("shared_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "household_record_shares_record_user_idx" ON "household_record_shares" USING btree ("record_kind","record_id","shared_with_user_id");--> statement-breakpoint
CREATE INDEX "household_record_shares_household_idx" ON "household_record_shares" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "household_record_shares_user_idx" ON "household_record_shares" USING btree ("shared_with_user_id");--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_household_id_household_workspaces_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_household_id_household_workspaces_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memories_household_id_idx" ON "memories" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "source_records_household_id_idx" ON "source_records" USING btree ("household_id");
