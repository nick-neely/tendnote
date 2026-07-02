ALTER TABLE "contact_methods" ADD COLUMN "display_value" text;--> statement-breakpoint
ALTER TABLE "contact_methods" ADD COLUMN "normalized_value" text;--> statement-breakpoint
UPDATE "contact_methods" SET "display_value" = "value" WHERE "display_value" IS NULL;--> statement-breakpoint
UPDATE "contact_methods" SET "normalized_value" = lower(trim("value")) WHERE "type" = 'email' AND "normalized_value" IS NULL;--> statement-breakpoint
UPDATE "contact_methods"
SET "normalized_value" = '+' || regexp_replace("value", '\D', '', 'g')
WHERE "type" = 'phone'
  AND "normalized_value" IS NULL
  AND "value" LIKE '+%'
  AND length(regexp_replace("value", '\D', '', 'g')) BETWEEN 8 AND 15;--> statement-breakpoint
CREATE INDEX "contact_methods_normalized_value_idx" ON "contact_methods" USING btree ("type","normalized_value");
