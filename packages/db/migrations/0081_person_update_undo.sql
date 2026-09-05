CREATE TABLE "person_updates" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"update_id" uuid NOT NULL,
	"expected_updated_at" timestamp with time zone NOT NULL,
	"changes" jsonb NOT NULL,
	"undone_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "person_updates" ADD CONSTRAINT "person_updates_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;