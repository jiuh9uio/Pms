CREATE TABLE "cleaning_log" (
	"task_id" uuid NOT NULL,
	"date" date NOT NULL,
	"user_name" text NOT NULL,
	"done_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cleaning_log_task_id_date_pk" PRIMARY KEY("task_id","date")
);
--> statement-breakpoint
CREATE TABLE "cleaning_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"area_id" uuid NOT NULL,
	"name" text NOT NULL,
	"interval_days" integer DEFAULT 1 NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cleaning_log" ADD CONSTRAINT "cleaning_log_task_id_cleaning_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."cleaning_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cleaning_tasks" ADD CONSTRAINT "cleaning_tasks_area_id_hygiene_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."hygiene_areas"("id") ON DELETE no action ON UPDATE no action;