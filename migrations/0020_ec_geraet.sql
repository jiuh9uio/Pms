CREATE TABLE "card_terminal_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"amount_cents" integer NOT NULL,
	"outcome" text NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"trace" text DEFAULT '' NOT NULL,
	"receipt_no" text DEFAULT '' NOT NULL,
	"card_name" text DEFAULT '' NOT NULL,
	"booking_id" uuid,
	"invoice_id" uuid,
	"payment_id" uuid,
	"user_name" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "card_terminal_log_at_idx" ON "card_terminal_log" USING btree ("at");