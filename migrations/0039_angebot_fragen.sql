ALTER TABLE "offers" ADD COLUMN "mode" text DEFAULT 'offer' NOT NULL;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "answers" jsonb;