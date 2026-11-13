ALTER TABLE "room_categories" ADD COLUMN "single_discount_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "room_categories" ADD COLUMN "extra_adult_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "room_categories" ADD COLUMN "extra_child_cents" integer DEFAULT 0 NOT NULL;