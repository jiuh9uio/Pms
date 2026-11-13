CREATE TABLE "guest_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_forms_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "guest_forms_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "guest_forms" ADD CONSTRAINT "guest_forms_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;