CREATE TABLE "general_action_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "general_actions" ADD COLUMN "area_id" uuid;--> statement-breakpoint
ALTER TABLE "general_action_areas" ADD CONSTRAINT "general_action_areas_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "general_action_areas_owner_sort_idx" ON "general_action_areas" USING btree ("owner_user_id","sort_order");--> statement-breakpoint
CREATE INDEX "general_action_areas_owner_archived_idx" ON "general_action_areas" USING btree ("owner_user_id","archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "general_action_areas_owner_name_active_idx" ON "general_action_areas" USING btree ("owner_user_id",lower("name")) WHERE "general_action_areas"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "general_actions" ADD CONSTRAINT "general_actions_area_id_general_action_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."general_action_areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "general_actions_owner_area_idx" ON "general_actions" USING btree ("owner_user_id","area_id");
