ALTER TABLE "offer_templates" ADD COLUMN "talk_steps" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "talk" jsonb;