ALTER TABLE "voucher_designs" ALTER COLUMN "mime" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "voucher_designs" ALTER COLUMN "data" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "voucher_designs" ADD COLUMN "layout" jsonb;