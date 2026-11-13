CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"street" text DEFAULT '' NOT NULL,
	"zip" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"country" text DEFAULT 'Deutschland' NOT NULL,
	"vat_id" text DEFAULT '' NOT NULL,
	"contact_name" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"payment_term_days" integer,
	"notes" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_rates" (
	"company_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"price_cents" integer NOT NULL,
	CONSTRAINT "company_rates_company_id_category_id_pk" PRIMARY KEY("company_id","category_id")
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "payment_term_days" integer;--> statement-breakpoint
ALTER TABLE "company_rates" ADD CONSTRAINT "company_rates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_rates" ADD CONSTRAINT "company_rates_category_id_room_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."room_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "companies_name_idx" ON "companies" USING btree ("name");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;