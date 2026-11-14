ALTER TABLE "bookings" ADD COLUMN "link_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "link_blocked" boolean DEFAULT false NOT NULL;