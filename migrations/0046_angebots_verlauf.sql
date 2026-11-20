CREATE TABLE "offer_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"what" text DEFAULT '' NOT NULL,
	"who" text DEFAULT '' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"inbox_mail_id" uuid
);
--> statement-breakpoint
ALTER TABLE "offer_events" ADD CONSTRAINT "offer_events_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "offer_events_offer_idx" ON "offer_events" USING btree ("offer_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "offer_events_inbox_idx" ON "offer_events" USING btree ("inbox_mail_id");