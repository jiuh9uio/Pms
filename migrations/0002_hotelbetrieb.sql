CREATE TYPE "public"."booking_room_status" AS ENUM('tentative', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."rate_rule_mode" AS ENUM('percent', 'amount', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."service_per" AS ENUM('stay', 'night', 'person', 'person_night');--> statement-breakpoint
CREATE TABLE "booking_room_nights" (
	"booking_room_id" uuid NOT NULL,
	"date" date NOT NULL,
	"price_cents" integer NOT NULL,
	"tax_rate_percent" numeric(5, 2) NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	CONSTRAINT "booking_room_nights_booking_room_id_date_pk" PRIMARY KEY("booking_room_id","date")
);
--> statement-breakpoint
CREATE TABLE "booking_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"allocation_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"status" "booking_room_status" DEFAULT 'confirmed' NOT NULL,
	"adults" integer DEFAULT 1 NOT NULL,
	"children" integer DEFAULT 0 NOT NULL,
	"price_manual" boolean DEFAULT false NOT NULL,
	"checked_in_at" timestamp with time zone,
	"checked_out_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "booking_rooms_allocation_id_unique" UNIQUE("allocation_id")
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"guest_id" uuid NOT NULL,
	"group_name" text DEFAULT '' NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"payment_method" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "bookings_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"booking_room_id" uuid,
	"service_id" uuid,
	"name" text NOT NULL,
	"quantity" numeric(10, 2) DEFAULT 1 NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"tax_rate_percent" numeric(5, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"salutation" text DEFAULT '' NOT NULL,
	"first_name" text DEFAULT '' NOT NULL,
	"last_name" text NOT NULL,
	"company" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"street" text DEFAULT '' NOT NULL,
	"zip" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"birthdate" date,
	"nationality" text DEFAULT '' NOT NULL,
	"id_number" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "number_sequences" (
	"key" text NOT NULL,
	"year" integer NOT NULL,
	"last" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "number_sequences_key_year_pk" PRIMARY KEY("key","year")
);
--> statement-breakpoint
CREATE TABLE "rate_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"weekdays" integer[] DEFAULT '{}' NOT NULL,
	"category_id" uuid,
	"mode" "rate_rule_mode" NOT NULL,
	"value" numeric(10, 2) NOT NULL,
	"priority" integer DEFAULT 10 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"allocation_id" uuid NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "room_blocks_allocation_id_unique" UNIQUE("allocation_id")
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"price_cents" integer NOT NULL,
	"per" "service_per" DEFAULT 'stay' NOT NULL,
	"tax_rate_id" uuid NOT NULL,
	"is_breakfast" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "room_categories" ADD COLUMN "base_price_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "price_override_cents" integer;--> statement-breakpoint
ALTER TABLE "booking_room_nights" ADD CONSTRAINT "booking_room_nights_booking_room_id_booking_rooms_id_fk" FOREIGN KEY ("booking_room_id") REFERENCES "public"."booking_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_rooms" ADD CONSTRAINT "booking_rooms_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_rooms" ADD CONSTRAINT "booking_rooms_allocation_id_room_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."room_allocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_rooms" ADD CONSTRAINT "booking_rooms_category_id_room_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."room_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_booking_room_id_booking_rooms_id_fk" FOREIGN KEY ("booking_room_id") REFERENCES "public"."booking_rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_rules" ADD CONSTRAINT "rate_rules_category_id_room_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."room_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_blocks" ADD CONSTRAINT "room_blocks_allocation_id_room_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."room_allocations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_tax_rate_id_tax_rates_id_fk" FOREIGN KEY ("tax_rate_id") REFERENCES "public"."tax_rates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_rooms_booking_idx" ON "booking_rooms" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "bookings_guest_idx" ON "bookings" USING btree ("guest_id");--> statement-breakpoint
CREATE INDEX "charges_booking_idx" ON "charges" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "guests_name_idx" ON "guests" USING btree ("last_name","first_name");