CREATE TABLE "offer_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"file_name" text NOT NULL,
	"data" "bytea" NOT NULL,
	"size_bytes" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offer_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"unit" text NOT NULL,
	"price_cents" integer NOT NULL,
	"tax_rate_percent" numeric(5, 2) NOT NULL,
	"area" text DEFAULT 'both' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offer_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"pos" integer NOT NULL,
	"item_id" uuid,
	"description" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"unit" text DEFAULT 'flat' NOT NULL,
	"quantity" numeric(10, 2) NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"tax_rate_percent" numeric(5, 2) NOT NULL,
	"total_cents" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offer_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"area" text DEFAULT 'both' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"intro" text DEFAULT '' NOT NULL,
	"closing" text DEFAULT '' NOT NULL,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"valid_days" integer DEFAULT 14 NOT NULL,
	"deposit_percent" integer DEFAULT 0 NOT NULL,
	"document_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"area" text DEFAULT 'both' NOT NULL,
	"template_id" uuid,
	"customer_company" text DEFAULT '' NOT NULL,
	"customer_name" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"street" text DEFAULT '' NOT NULL,
	"zip" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"event_date" date,
	"event_end" date,
	"persons" integer DEFAULT 1 NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"intro" text DEFAULT '' NOT NULL,
	"closing" text DEFAULT '' NOT NULL,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"valid_until" date,
	"deposit_percent" integer DEFAULT 0 NOT NULL,
	"document_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"sent_at" timestamp with time zone,
	"sent_to" text DEFAULT '' NOT NULL,
	"sent_pdf" "bytea",
	"sent_hash" text DEFAULT '' NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" text DEFAULT '' NOT NULL,
	"accepted_method" text DEFAULT '' NOT NULL,
	"accepted_ip" text,
	"accepted_hash" text DEFAULT '' NOT NULL,
	"declined_at" timestamp with time zone,
	"booking_id" uuid,
	"table_reservation_id" uuid,
	"link_version" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "offers_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "offer_lines" ADD CONSTRAINT "offer_lines_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_lines" ADD CONSTRAINT "offer_lines_item_id_offer_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."offer_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_template_id_offer_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."offer_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_table_reservation_id_table_reservations_id_fk" FOREIGN KEY ("table_reservation_id") REFERENCES "public"."table_reservations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "offer_lines_offer_idx" ON "offer_lines" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "offers_status_idx" ON "offers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "offers_event_idx" ON "offers" USING btree ("event_date");