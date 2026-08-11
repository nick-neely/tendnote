CREATE TYPE "public"."household_calendar_connection_status" AS ENUM('connected', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."household_calendar_disconnect_reason" AS ENUM('owner_disconnected', 'connector_departed', 'household_dissolved');--> statement-breakpoint
CREATE TYPE "public"."household_event_plan_link_kind" AS ENUM('general_action', 'followup', 'saved_item');--> statement-breakpoint
CREATE TYPE "public"."household_event_plan_status" AS ENUM('active', 'archived');--> statement-breakpoint
ALTER TYPE "public"."visibility_record_kind" ADD VALUE 'household_event_plan';--> statement-breakpoint
CREATE TABLE "household_calendar_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"connector_user_id" text NOT NULL,
	"designated_by_user_id" text NOT NULL,
	"provider_key" text NOT NULL,
	"capability_key" text NOT NULL,
	"calendar_id" text NOT NULL,
	"label" text NOT NULL,
	"status" "household_calendar_connection_status" DEFAULT 'connected' NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	"disconnected_reason" "household_calendar_disconnect_reason",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household_calendar_event_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"calendar_id" text NOT NULL,
	"window_key" text NOT NULL,
	"events" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household_event_plan_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"link_kind" "household_event_plan_link_kind" NOT NULL,
	"record_id" uuid NOT NULL,
	"linked_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household_event_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"created_by_user_id" text NOT NULL,
	"last_actor_user_id" text NOT NULL,
	"title" text NOT NULL,
	"details" text,
	"planned_for" timestamp with time zone,
	"status" "household_event_plan_status" DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"calendar_connection_id" uuid,
	"calendar_id" text,
	"calendar_provider_event_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "household_calendar_connections" ADD CONSTRAINT "household_calendar_connections_household_id_household_workspaces_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_calendar_connections" ADD CONSTRAINT "household_calendar_connections_connector_user_id_user_id_fk" FOREIGN KEY ("connector_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_calendar_connections" ADD CONSTRAINT "household_calendar_connections_designated_by_user_id_user_id_fk" FOREIGN KEY ("designated_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_calendar_event_cache" ADD CONSTRAINT "household_calendar_event_cache_connection_id_household_calendar_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."household_calendar_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_event_plan_links" ADD CONSTRAINT "household_event_plan_links_plan_id_household_event_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."household_event_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_event_plan_links" ADD CONSTRAINT "household_event_plan_links_linked_by_user_id_user_id_fk" FOREIGN KEY ("linked_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_event_plans" ADD CONSTRAINT "household_event_plans_household_id_household_workspaces_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_event_plans" ADD CONSTRAINT "household_event_plans_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_event_plans" ADD CONSTRAINT "household_event_plans_last_actor_user_id_user_id_fk" FOREIGN KEY ("last_actor_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_event_plans" ADD CONSTRAINT "household_event_plans_calendar_connection_id_household_calendar_connections_id_fk" FOREIGN KEY ("calendar_connection_id") REFERENCES "public"."household_calendar_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "household_calendar_connections_calendar_idx" ON "household_calendar_connections" USING btree ("household_id","connector_user_id","provider_key","capability_key","calendar_id");--> statement-breakpoint
CREATE INDEX "household_calendar_connections_household_status_idx" ON "household_calendar_connections" USING btree ("household_id","status");--> statement-breakpoint
CREATE INDEX "household_calendar_connections_connector_idx" ON "household_calendar_connections" USING btree ("household_id","connector_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "household_calendar_event_cache_key_idx" ON "household_calendar_event_cache" USING btree ("connection_id","calendar_id","window_key");--> statement-breakpoint
CREATE INDEX "household_calendar_event_cache_fetched_at_idx" ON "household_calendar_event_cache" USING btree ("connection_id","fetched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "household_event_plan_links_record_idx" ON "household_event_plan_links" USING btree ("plan_id","link_kind","record_id");--> statement-breakpoint
CREATE INDEX "household_event_plan_links_plan_idx" ON "household_event_plan_links" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "household_event_plans_household_status_idx" ON "household_event_plans" USING btree ("household_id","status","planned_for");--> statement-breakpoint
CREATE INDEX "household_event_plans_calendar_event_idx" ON "household_event_plans" USING btree ("calendar_connection_id","calendar_provider_event_id");