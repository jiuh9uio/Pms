CREATE TABLE "invoice_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"what" text DEFAULT '' NOT NULL,
	"who" text DEFAULT '' NOT NULL,
	"to_addr" text DEFAULT '' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"inbox_mail_id" uuid
);
--> statement-breakpoint
ALTER TABLE "invoice_events" ADD CONSTRAINT "invoice_events_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_events_invoice_idx" ON "invoice_events" USING btree ("invoice_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_events_inbox_idx" ON "invoice_events" USING btree ("inbox_mail_id");