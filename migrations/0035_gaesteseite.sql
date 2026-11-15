CREATE TABLE "category_photos" (
	"category_id" uuid PRIMARY KEY NOT NULL,
	"mime" text NOT NULL,
	"data" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "category_photos" ADD CONSTRAINT "category_photos_category_id_room_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."room_categories"("id") ON DELETE cascade ON UPDATE no action;