CREATE TABLE "mail_case_out" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"by" text DEFAULT '' NOT NULL,
	"to_addr" text DEFAULT '' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"contact_name" text DEFAULT '' NOT NULL,
	"contact_addr" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_cases_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "inbox_mails" ADD COLUMN "case_id" uuid;--> statement-breakpoint
ALTER TABLE "mail_case_out" ADD CONSTRAINT "mail_case_out_case_id_mail_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."mail_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_case_out_case_idx" ON "mail_case_out" USING btree ("case_id","at");--> statement-breakpoint
CREATE INDEX "mail_cases_addr_idx" ON "mail_cases" USING btree ("contact_addr");--> statement-breakpoint
ALTER TABLE "inbox_mails" ADD CONSTRAINT "inbox_mails_case_id_mail_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."mail_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_mails_case_idx" ON "inbox_mails" USING btree ("case_id");