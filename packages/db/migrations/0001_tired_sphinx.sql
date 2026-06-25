CREATE TABLE "person_context_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"person_id" uuid NOT NULL,
	"summary" text NOT NULL,
	"supporting_references" jsonb DEFAULT '{"personIds":[],"memoryIds":[],"sourceRecordIds":[],"suggestedMemoryIds":[],"followupIds":[]}'::jsonb NOT NULL,
	"generator_version" text NOT NULL,
	"input_fingerprint" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "person_context_snapshots" ADD CONSTRAINT "person_context_snapshots_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_context_snapshots" ADD CONSTRAINT "person_context_snapshots_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "person_context_snapshots_owner_person_idx" ON "person_context_snapshots" USING btree ("owner_user_id","person_id");--> statement-breakpoint
CREATE INDEX "person_context_snapshots_person_id_idx" ON "person_context_snapshots" USING btree ("person_id");