CREATE TABLE "blob_deletions" (
	"pathname" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_uploads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"pathname" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"ready" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_uploads_pathname_unique" UNIQUE("pathname")
);
--> statement-breakpoint
ALTER TABLE "asset_evidence_files" ALTER COLUMN "bytes" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_evidence_files" ADD COLUMN "blob_path" text;--> statement-breakpoint
ALTER TABLE "file_uploads" ADD CONSTRAINT "file_uploads_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION enqueue_deleted_blob() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'file_uploads' THEN
    INSERT INTO blob_deletions(pathname) VALUES (OLD.pathname) ON CONFLICT DO NOTHING;
  ELSIF OLD.blob_path IS NOT NULL THEN
    INSERT INTO blob_deletions(pathname) VALUES (OLD.blob_path) ON CONFLICT DO NOTHING;
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER file_upload_blob_cleanup AFTER DELETE ON file_uploads
FOR EACH ROW EXECUTE FUNCTION enqueue_deleted_blob();
--> statement-breakpoint
CREATE TRIGGER evidence_blob_cleanup AFTER DELETE ON asset_evidence_files
FOR EACH ROW EXECUTE FUNCTION enqueue_deleted_blob();
