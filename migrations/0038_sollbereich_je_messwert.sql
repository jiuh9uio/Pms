ALTER TABLE "hygiene_readings" ADD COLUMN "min_c" numeric(5, 1);--> statement-breakpoint
ALTER TABLE "hygiene_readings" ADD COLUMN "max_c" numeric(5, 1);--> statement-breakpoint
ALTER TABLE "hygiene_readings" ADD COLUMN "range_saved" boolean DEFAULT false NOT NULL;