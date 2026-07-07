ALTER TYPE "public"."visibility_record_kind" ADD VALUE 'general_action';--> statement-breakpoint
CREATE TABLE "general_action_people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"general_action_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "general_actions" ADD COLUMN "asset_hints" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "general_action_people" ADD CONSTRAINT "general_action_people_general_action_id_general_actions_id_fk" FOREIGN KEY ("general_action_id") REFERENCES "public"."general_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_action_people" ADD CONSTRAINT "general_action_people_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "general_action_people_action_person_idx" ON "general_action_people" USING btree ("general_action_id","person_id");--> statement-breakpoint
CREATE INDEX "general_action_people_person_idx" ON "general_action_people" USING btree ("person_id");