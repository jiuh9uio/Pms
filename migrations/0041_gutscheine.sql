CREATE TABLE "voucher_designs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"data" "bytea" NOT NULL,
	"text_pos" text DEFAULT 'right' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vouchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"pin_enc" text,
	"pin_hint" text DEFAULT '' NOT NULL,
	"pos_card_no" text DEFAULT '' NOT NULL,
	"value_cents" integer NOT NULL,
	"issued_on" date NOT NULL,
	"valid_until" date,
	"buyer_name" text DEFAULT '' NOT NULL,
	"buyer_company" text DEFAULT '' NOT NULL,
	"buyer_street" text DEFAULT '' NOT NULL,
	"buyer_zip" text DEFAULT '' NOT NULL,
	"buyer_city" text DEFAULT '' NOT NULL,
	"buyer_country" text DEFAULT 'Deutschland' NOT NULL,
	"buyer_email" text DEFAULT '' NOT NULL,
	"recipient_name" text DEFAULT '' NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"design_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"invoice_id" uuid,
	"sent_at" timestamp with time zone,
	"sent_to" text,
	"note" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_design_id_voucher_designs_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."voucher_designs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vouchers_number_idx" ON "vouchers" USING btree ("number");--> statement-breakpoint
CREATE INDEX "vouchers_status_idx" ON "vouchers" USING btree ("status");--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_status_check" CHECK ("status" in ('active', 'redeemed', 'cancelled'));--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_value_check" CHECK ("value_cents" > 0);
