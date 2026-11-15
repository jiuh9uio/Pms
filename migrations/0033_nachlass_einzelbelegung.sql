ALTER TABLE "room_categories" ADD COLUMN "long_stay_single_discount_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "room_categories" SET "long_stay_single_discount_cents" = "long_stay_discount_cents";
