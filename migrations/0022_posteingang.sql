CREATE TABLE "inbox_mails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uid_validity" text NOT NULL,
	"uid" integer NOT NULL,
	"message_id" text DEFAULT '' NOT NULL,
	"from_name" text DEFAULT '' NOT NULL,
	"from_addr" text DEFAULT '' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"kind" text NOT NULL,
	"extract" jsonb NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"link_kind" text,
	"link_id" uuid,
	"handled_by" text DEFAULT '' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_mails_uid_idx" ON "inbox_mails" USING btree ("uid_validity","uid");--> statement-breakpoint
CREATE INDEX "inbox_mails_received_idx" ON "inbox_mails" USING btree ("received_at");