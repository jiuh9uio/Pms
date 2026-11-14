ALTER TABLE "inbox_mails" ADD COLUMN "replied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inbox_mails" ADD COLUMN "replied_by" text DEFAULT '' NOT NULL;