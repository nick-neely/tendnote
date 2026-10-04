CREATE TABLE "service_wide_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reason" text NOT NULL,
	"placed_at" timestamp with time zone NOT NULL,
	"lifted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "service_wide_holds_one_open_idx" ON "service_wide_holds" USING btree (("lifted_at" is null)) WHERE "service_wide_holds"."lifted_at" is null;