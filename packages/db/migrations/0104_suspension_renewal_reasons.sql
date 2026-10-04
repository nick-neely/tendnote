ALTER TABLE "suspension_deadline_renewals" ADD COLUMN "reason" text;--> statement-breakpoint
-- Renewals recorded before they carried a reason (#740) say so, rather than
-- inventing one.
UPDATE "suspension_deadline_renewals" SET "reason" = 'Recorded before renewals carried a reason.' WHERE "reason" IS NULL;--> statement-breakpoint
ALTER TABLE "suspension_deadline_renewals" ALTER COLUMN "reason" SET NOT NULL;
