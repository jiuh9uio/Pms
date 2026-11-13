ALTER TABLE "hygiene_readings" ALTER COLUMN "value_c" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "hygiene_readings" ADD COLUMN "confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "modules" text[] DEFAULT '{hotel,kontrollen}' NOT NULL;