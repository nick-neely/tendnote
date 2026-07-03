CREATE TYPE "public"."household_member_status" AS ENUM('invited', 'active', 'removed');--> statement-breakpoint
CREATE TYPE "public"."household_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TABLE "household_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"invited_by_user_id" text NOT NULL,
	"role" "household_role" NOT NULL,
	"status" "household_member_status" NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household_workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"default_scope" "privacy_scope" DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "household_memberships" ADD CONSTRAINT "household_memberships_household_id_household_workspaces_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_memberships" ADD CONSTRAINT "household_memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_memberships" ADD CONSTRAINT "household_memberships_invited_by_user_id_user_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_workspaces" ADD CONSTRAINT "household_workspaces_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "household_memberships_household_user_idx" ON "household_memberships" USING btree ("household_id","user_id");--> statement-breakpoint
CREATE INDEX "household_memberships_user_status_idx" ON "household_memberships" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "household_memberships_household_status_idx" ON "household_memberships" USING btree ("household_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "household_workspaces_owner_user_id_idx" ON "household_workspaces" USING btree ("owner_user_id");