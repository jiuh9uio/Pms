CREATE TABLE "hygiene_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "hygiene_areas_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "hygiene_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"area_id" uuid NOT NULL,
	"name" text NOT NULL,
	"min_c" numeric(5, 1),
	"max_c" numeric(5, 1),
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hygiene_readings" (
	"point_id" uuid NOT NULL,
	"date" date NOT NULL,
	"value_c" numeric(5, 1) NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"user_name" text NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hygiene_readings_point_id_date_pk" PRIMARY KEY("point_id","date")
);
--> statement-breakpoint
CREATE TABLE "inspection_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type_id" uuid NOT NULL,
	"text" text NOT NULL,
	"ready" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'generic' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "inspection_types_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "inspection_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type_id" uuid NOT NULL,
	"date" date NOT NULL,
	"inspector" text DEFAULT '' NOT NULL,
	"result" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"recorded_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hygiene_points" ADD CONSTRAINT "hygiene_points_area_id_hygiene_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."hygiene_areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hygiene_readings" ADD CONSTRAINT "hygiene_readings_point_id_hygiene_points_id_fk" FOREIGN KEY ("point_id") REFERENCES "public"."hygiene_points"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_items" ADD CONSTRAINT "inspection_items_type_id_inspection_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."inspection_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_visits" ADD CONSTRAINT "inspection_visits_type_id_inspection_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."inspection_types"("id") ON DELETE cascade ON UPDATE no action;