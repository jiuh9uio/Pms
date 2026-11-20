ALTER TABLE "vouchers" ADD COLUMN "pay_method" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "cashier" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "redeemed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "redeemed_by" text;