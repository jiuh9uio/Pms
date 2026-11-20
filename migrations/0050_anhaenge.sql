CREATE TABLE "inbox_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inbox_mail_id" uuid NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"mime" text DEFAULT '' NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbox_attachments" ADD CONSTRAINT "inbox_attachments_inbox_mail_id_inbox_mails_id_fk" FOREIGN KEY ("inbox_mail_id") REFERENCES "public"."inbox_mails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_attachments_mail_idx" ON "inbox_attachments" USING btree ("inbox_mail_id");