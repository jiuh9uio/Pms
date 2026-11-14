CREATE TABLE "team_note_reads" (
	"note_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"user_name" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_note_reads_note_id_user_id_pk" PRIMARY KEY("note_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "team_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"place" text DEFAULT '' NOT NULL,
	"due_date" date,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by" text NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_by" text DEFAULT '' NOT NULL,
	"done_at" timestamp with time zone,
	"done_note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_note_reads" ADD CONSTRAINT "team_note_reads_note_id_team_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."team_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_notes_created_idx" ON "team_notes" USING btree ("created_at");