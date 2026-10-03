CREATE TYPE "public"."public_activity_event" AS ENUM('page_viewed', 'demo_started', 'demo_completed', 'signup_clicked');--> statement-breakpoint
CREATE TYPE "public"."public_page" AS ENUM('home', 'product', 'demo', 'pricing', 'about', 'privacy_and_ai', 'support', 'fair_use', 'terms', 'privacy');--> statement-breakpoint
CREATE TABLE "public_activity_daily_counts" (
	"day" date NOT NULL,
	"event" "public_activity_event" NOT NULL,
	"page" "public_page" NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "public_activity_daily_counts_pkey" PRIMARY KEY("day","event","page")
);
