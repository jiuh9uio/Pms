CREATE TABLE "tse_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"status" text NOT NULL,
	"client_id" text DEFAULT '' NOT NULL,
	"serial_hex" text DEFAULT '' NOT NULL,
	"transaction_number" integer,
	"signature_counter" integer,
	"start_time" text DEFAULT '' NOT NULL,
	"finish_time" text DEFAULT '' NOT NULL,
	"signature" text DEFAULT '' NOT NULL,
	"process_type" text DEFAULT '' NOT NULL,
	"process_data" text DEFAULT '' NOT NULL,
	"public_key" text DEFAULT '' NOT NULL,
	"algorithm" text DEFAULT '' NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tse_records_payment_id_unique" UNIQUE("payment_id")
);
--> statement-breakpoint
ALTER TABLE "tse_records" ADD CONSTRAINT "tse_records_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;