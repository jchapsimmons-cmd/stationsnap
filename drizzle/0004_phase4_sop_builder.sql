CREATE TYPE "public"."file_media_type" AS ENUM('image', 'video');--> statement-breakpoint
CREATE TYPE "public"."file_status" AS ENUM('processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."sop_category" AS ENUM('recipe', 'cleaning', 'opening', 'closing', 'safety', 'equipment', 'customer_service', 'general_procedure');--> statement-breakpoint
CREATE TYPE "public"."sop_difficulty" AS ENUM('beginner', 'intermediate', 'advanced');--> statement-breakpoint
CREATE TYPE "public"."sop_lifecycle_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."sop_material_kind" AS ENUM('material', 'ingredient');--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"uploader_manager_user_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"original_name" text NOT NULL,
	"media_type" "file_media_type" NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"checksum" text NOT NULL,
	"status" "file_status" DEFAULT 'processing' NOT NULL,
	"width" integer,
	"height" integer,
	"duration_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "sop_materials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sop_version_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" "sop_material_kind" NOT NULL,
	"name" text NOT NULL,
	"quantity" text DEFAULT '' NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"display_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sop_steps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sop_version_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"display_order" integer NOT NULL,
	"title" text,
	"instruction" text NOT NULL,
	"image_file_id" uuid,
	"video_file_id" uuid,
	"warning" text,
	"quantity" text,
	"unit" text,
	"equipment_setting" text,
	"timer_seconds" integer,
	"is_required" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sop_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sop_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" "sop_lifecycle_status" DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" "sop_category" NOT NULL,
	"estimated_minutes" integer,
	"difficulty" "sop_difficulty" DEFAULT 'beginner' NOT NULL,
	"cover_image_file_id" uuid,
	"source_video_file_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp with time zone,
	"published_by_manager_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sop_versions_sop_version_number_uidx" UNIQUE("sop_id","version_number"),
	CONSTRAINT "sop_versions_id_sop_unique" UNIQUE("id","sop_id"),
	CONSTRAINT "sop_versions_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "sop_warnings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sop_version_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"text" text NOT NULL,
	"display_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sops" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"station_id" uuid,
	"category" "sop_category" NOT NULL,
	"status" "sop_lifecycle_status" DEFAULT 'draft' NOT NULL,
	"current_version_id" uuid,
	"created_by_manager_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sops_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "stations" ADD CONSTRAINT "stations_id_org_location_unique" UNIQUE("id","organization_id","location_id");--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploader_manager_user_id_manager_users_id_fk" FOREIGN KEY ("uploader_manager_user_id") REFERENCES "public"."manager_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_materials" ADD CONSTRAINT "sop_materials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_materials" ADD CONSTRAINT "sop_materials_version_org_fk" FOREIGN KEY ("sop_version_id","organization_id") REFERENCES "public"."sop_versions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_steps" ADD CONSTRAINT "sop_steps_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_steps" ADD CONSTRAINT "sop_steps_version_org_fk" FOREIGN KEY ("sop_version_id","organization_id") REFERENCES "public"."sop_versions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_steps" ADD CONSTRAINT "sop_steps_image_file_org_fk" FOREIGN KEY ("image_file_id","organization_id") REFERENCES "public"."files"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_steps" ADD CONSTRAINT "sop_steps_video_file_org_fk" FOREIGN KEY ("video_file_id","organization_id") REFERENCES "public"."files"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_versions" ADD CONSTRAINT "sop_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_versions" ADD CONSTRAINT "sop_versions_published_by_manager_user_id_manager_users_id_fk" FOREIGN KEY ("published_by_manager_user_id") REFERENCES "public"."manager_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_versions" ADD CONSTRAINT "sop_versions_sop_org_fk" FOREIGN KEY ("sop_id","organization_id") REFERENCES "public"."sops"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_versions" ADD CONSTRAINT "sop_versions_cover_file_org_fk" FOREIGN KEY ("cover_image_file_id","organization_id") REFERENCES "public"."files"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_versions" ADD CONSTRAINT "sop_versions_source_file_org_fk" FOREIGN KEY ("source_video_file_id","organization_id") REFERENCES "public"."files"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_warnings" ADD CONSTRAINT "sop_warnings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_warnings" ADD CONSTRAINT "sop_warnings_version_org_fk" FOREIGN KEY ("sop_version_id","organization_id") REFERENCES "public"."sop_versions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sops" ADD CONSTRAINT "sops_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sops" ADD CONSTRAINT "sops_created_by_manager_user_id_manager_users_id_fk" FOREIGN KEY ("created_by_manager_user_id") REFERENCES "public"."manager_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sops" ADD CONSTRAINT "sops_location_org_fk" FOREIGN KEY ("location_id","organization_id") REFERENCES "public"."locations"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sops" ADD CONSTRAINT "sops_station_org_location_fk" FOREIGN KEY ("station_id","organization_id","location_id") REFERENCES "public"."stations"("id","organization_id","location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "files_object_key_uidx" ON "files" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "files_org_status_idx" ON "files" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "sop_materials_version_order_idx" ON "sop_materials" USING btree ("sop_version_id","display_order");--> statement-breakpoint
CREATE INDEX "sop_steps_version_order_idx" ON "sop_steps" USING btree ("sop_version_id","display_order");--> statement-breakpoint
CREATE INDEX "sop_versions_org_status_idx" ON "sop_versions" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "sop_warnings_version_order_idx" ON "sop_warnings" USING btree ("sop_version_id","display_order");--> statement-breakpoint
CREATE INDEX "sops_org_location_status_idx" ON "sops" USING btree ("organization_id","location_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "sops_org_category_idx" ON "sops" USING btree ("organization_id","category");--> statement-breakpoint
CREATE INDEX "sops_org_station_idx" ON "sops" USING btree ("organization_id","station_id");