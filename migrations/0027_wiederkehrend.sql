CREATE TABLE "team_recurring" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text" text NOT NULL,
	"place" text DEFAULT '' NOT NULL,
	"repeat" text NOT NULL,
	"day" integer DEFAULT 0 NOT NULL,
	"last_created" date,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
