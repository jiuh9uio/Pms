ALTER TABLE "mail_cases" ADD COLUMN "assignee" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_cases" ADD COLUMN "booking_id" uuid;--> statement-breakpoint
ALTER TABLE "mail_cases" ADD CONSTRAINT "mail_cases_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_cases_booking_idx" ON "mail_cases" USING btree ("booking_id");