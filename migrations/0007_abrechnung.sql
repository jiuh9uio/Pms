CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"pos" integer NOT NULL,
	"description" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"quantity" numeric(10, 2) NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"tax_rate_percent" numeric(5, 2) NOT NULL,
	"total_cents" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text,
	"kind" text DEFAULT 'invoice' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"booking_id" uuid,
	"cancels_id" uuid,
	"recipient_company" text DEFAULT '' NOT NULL,
	"recipient_name" text DEFAULT '' NOT NULL,
	"recipient_street" text DEFAULT '' NOT NULL,
	"recipient_zip" text DEFAULT '' NOT NULL,
	"recipient_city" text DEFAULT '' NOT NULL,
	"recipient_country" text DEFAULT '' NOT NULL,
	"recipient_vat_id" text DEFAULT '' NOT NULL,
	"service_from" date,
	"service_to" date,
	"issue_date" date,
	"due_date" date,
	"notes" text DEFAULT '' NOT NULL,
	"issuer" jsonb,
	"gross_cents" integer DEFAULT 0 NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"issued_by" text DEFAULT '' NOT NULL,
	"issued_at" timestamp with time zone,
	"cancel_reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "invoices_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid,
	"invoice_id" uuid,
	"amount_cents" integer NOT NULL,
	"method" text NOT NULL,
	"date" date NOT NULL,
	"payer" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"reverses_id" uuid,
	"recorded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_idx" ON "invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoices_booking_idx" ON "invoices" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "invoices_issue_idx" ON "invoices" USING btree ("issue_date");--> statement-breakpoint
CREATE INDEX "payments_booking_idx" ON "payments" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("invoice_id");