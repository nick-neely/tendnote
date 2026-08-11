CREATE TYPE "public"."household_record_ownership" AS ENUM('member_owned', 'household_native');--> statement-breakpoint
ALTER TABLE "saved_item_events" ALTER COLUMN "owner_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_items" ALTER COLUMN "owner_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_items" ADD COLUMN "ownership" "household_record_ownership" DEFAULT 'member_owned' NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_items" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "saved_items_household_ownership_idx" ON "saved_items" USING btree ("household_id","ownership","status");--> statement-breakpoint
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_ownership_check" CHECK ((
        ("saved_items"."ownership" = 'member_owned' and "saved_items"."owner_user_id" is not null)
        or (
          "saved_items"."ownership" = 'household_native'
          and "saved_items"."owner_user_id" is null
          and "saved_items"."household_id" is not null
          and "saved_items"."scope" = 'household'
          and "saved_items"."created_by_user_id" is not null
        )
      ));