CREATE TABLE "contact_import_provider_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"person_id" uuid NOT NULL,
	"provider_key" text NOT NULL,
	"provider_contact_id" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_import_provider_refs" ADD CONSTRAINT "contact_import_provider_refs_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_import_provider_refs" ADD CONSTRAINT "contact_import_provider_refs_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_import_provider_refs_owner_idx" ON "contact_import_provider_refs" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "contact_import_provider_refs_person_idx" ON "contact_import_provider_refs" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_import_provider_refs_provider_contact_idx" ON "contact_import_provider_refs" USING btree ("owner_user_id","provider_key","provider_contact_id");