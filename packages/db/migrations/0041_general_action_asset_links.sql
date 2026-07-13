CREATE TABLE "general_action_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"general_action_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"hint_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "general_action_assets" ADD CONSTRAINT "general_action_assets_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_action_assets" ADD CONSTRAINT "general_action_assets_general_action_id_general_actions_id_fk" FOREIGN KEY ("general_action_id") REFERENCES "public"."general_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_action_assets" ADD CONSTRAINT "general_action_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "general_action_assets_action_asset_idx" ON "general_action_assets" USING btree ("general_action_id","asset_id");--> statement-breakpoint
CREATE INDEX "general_action_assets_asset_idx" ON "general_action_assets" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "general_action_assets_owner_idx" ON "general_action_assets" USING btree ("owner_user_id");