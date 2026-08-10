CREATE TABLE "person_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"record_kind" "visibility_record_kind" NOT NULL,
	"record_id" uuid NOT NULL,
	"label" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "person_references" ADD CONSTRAINT "person_references_household_id_household_workspaces_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_references" ADD CONSTRAINT "person_references_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "person_references_record_label_idx" ON "person_references" USING btree ("record_kind","record_id","label");--> statement-breakpoint
CREATE INDEX "person_references_household_idx" ON "person_references" USING btree ("household_id");