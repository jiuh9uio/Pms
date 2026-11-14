ALTER TABLE "bookings" ADD COLUMN "arrival_time" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "guest_message" text DEFAULT '' NOT NULL;