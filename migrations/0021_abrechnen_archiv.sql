CREATE TABLE "invoice_documents" (
	"invoice_id" uuid PRIMARY KEY NOT NULL,
	"pdf" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "source_kind" text;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "source_from" date;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "source_to" date;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "given_cents" integer;--> statement-breakpoint
ALTER TABLE "invoice_documents" ADD CONSTRAINT "invoice_documents_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Archivkopien dürfen weder geändert noch gelöscht werden
CREATE FUNCTION invoice_documents_protect() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Archivierte Rechnungs-PDFs können nicht geändert oder gelöscht werden';
END $$;
--> statement-breakpoint
CREATE TRIGGER invoice_documents_protect BEFORE UPDATE OR DELETE ON "invoice_documents" FOR EACH ROW EXECUTE FUNCTION invoice_documents_protect();
--> statement-breakpoint
CREATE TRIGGER invoice_documents_no_truncate BEFORE TRUNCATE ON "invoice_documents" FOR EACH STATEMENT EXECUTE FUNCTION invoice_documents_protect();
