CREATE TABLE "einvoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"invoice_id" uuid,
	"number" text NOT NULL,
	"issue_date" date NOT NULL,
	"buyer_name" text NOT NULL,
	"buyer_email" text DEFAULT '' NOT NULL,
	"gross_cents" integer NOT NULL,
	"original_name" text DEFAULT '' NOT NULL,
	"generated_pdf" boolean DEFAULT false NOT NULL,
	"data" jsonb NOT NULL,
	"xml" text NOT NULL,
	"pdf" "bytea" NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"sent_to" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"to_addr" text NOT NULL,
	"subject" text NOT NULL,
	"attachments" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"user_name" text NOT NULL,
	"einvoice_id" uuid
);
--> statement-breakpoint
ALTER TABLE "einvoices" ADD CONSTRAINT "einvoices_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "einvoices_created_idx" ON "einvoices" USING btree ("created_at");