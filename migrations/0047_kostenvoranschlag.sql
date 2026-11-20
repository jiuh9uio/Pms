ALTER TABLE "invoices" ADD COLUMN "estimate_number" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_estimate_number_unique" UNIQUE("estimate_number");