CREATE TYPE "public"."access_source" AS ENUM('bootstrap', 'manual_grant', 'beta_flag');--> statement-breakpoint
CREATE TYPE "public"."access_status" AS ENUM('pending', 'granted', 'denied');--> statement-breakpoint
CREATE TABLE "access_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"status" "access_status" DEFAULT 'pending' NOT NULL,
	"source" "access_source",
	"granted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_profiles_single_bootstrap_idx" ON "access_profiles" USING btree ("source") WHERE "access_profiles"."source" = 'bootstrap';