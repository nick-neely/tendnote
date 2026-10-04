CREATE TABLE "account_ceiling_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"cost_category" "cost_category" NOT NULL,
	"ceiling_micro_usd" bigint NOT NULL,
	"period_start" date NOT NULL,
	"expires_on" date NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admission_exceptions" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account_ceiling_overrides" ADD CONSTRAINT "account_ceiling_overrides_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_ceiling_overrides_raise_unique" ON "account_ceiling_overrides" USING btree ("user_id","cost_category","period_start","ceiling_micro_usd");