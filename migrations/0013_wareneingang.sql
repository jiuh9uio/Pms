CREATE TABLE "goods_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"supplier" text NOT NULL,
	"goods" text NOT NULL,
	"temp_c" numeric(5, 1),
	"ok" boolean NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"user_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "goods_receipts_date_idx" ON "goods_receipts" USING btree ("date");