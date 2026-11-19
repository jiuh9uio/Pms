CREATE TABLE "stock_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"partner" text NOT NULL,
	"article" text NOT NULL,
	"qty" integer NOT NULL,
	"ref" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"user_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" text
);
--> statement-breakpoint
CREATE INDEX "stock_moves_partner_idx" ON "stock_moves" USING btree ("partner");--> statement-breakpoint
CREATE INDEX "stock_moves_date_idx" ON "stock_moves" USING btree ("date");--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_kind_check" CHECK ("kind" in ('in', 'out', 'empty_back', 'empty_return'));--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_qty_check" CHECK ("qty" > 0);
