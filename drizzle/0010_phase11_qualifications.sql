CREATE TYPE "public"."qualification_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."training_path_version_policy" AS ENUM('current_version', 'any_passed_version');--> statement-breakpoint
CREATE TABLE "employee_qualifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"source_path_id" uuid NOT NULL,
	"awarded_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"status" "qualification_status" DEFAULT 'active' NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_manager_user_id" uuid,
	"revoked_note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_qualifications_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "qualification_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"station_id" uuid,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"default_validity_days" integer,
	"status" "record_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qualification_definitions_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "qualification_supporting_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"qualification_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qualification_supporting_sessions_qualification_session_uidx" UNIQUE("qualification_id","session_id")
);
--> statement-breakpoint
CREATE TABLE "training_path_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"path_id" uuid NOT NULL,
	"sop_id" uuid NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"display_order" integer NOT NULL,
	"version_policy" "training_path_version_policy" DEFAULT 'current_version' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_path_items_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "training_path_items_path_sop_uidx" UNIQUE("path_id","sop_id"),
	CONSTRAINT "training_path_items_path_order_uidx" UNIQUE("path_id","display_order")
);
--> statement-breakpoint
CREATE TABLE "training_paths" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"station_id" uuid,
	"qualification_definition_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"enforce_order" boolean DEFAULT true NOT NULL,
	"status" "record_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_paths_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "training_paths_definition_uidx" UNIQUE("qualification_definition_id")
);
--> statement-breakpoint
ALTER TABLE "employee_qualifications" ADD CONSTRAINT "employee_qualifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_qualifications" ADD CONSTRAINT "employee_qualifications_revoked_by_manager_user_id_manager_users_id_fk" FOREIGN KEY ("revoked_by_manager_user_id") REFERENCES "public"."manager_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_qualifications" ADD CONSTRAINT "employee_qualifications_employee_org_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employees"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_qualifications" ADD CONSTRAINT "employee_qualifications_definition_org_fk" FOREIGN KEY ("definition_id","organization_id") REFERENCES "public"."qualification_definitions"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_qualifications" ADD CONSTRAINT "employee_qualifications_source_path_org_fk" FOREIGN KEY ("source_path_id","organization_id") REFERENCES "public"."training_paths"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_definitions" ADD CONSTRAINT "qualification_definitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_definitions" ADD CONSTRAINT "qualification_definitions_location_org_fk" FOREIGN KEY ("location_id","organization_id") REFERENCES "public"."locations"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_definitions" ADD CONSTRAINT "qualification_definitions_station_org_location_fk" FOREIGN KEY ("station_id","organization_id","location_id") REFERENCES "public"."stations"("id","organization_id","location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_supporting_sessions" ADD CONSTRAINT "qualification_supporting_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_supporting_sessions" ADD CONSTRAINT "qualification_supporting_sessions_qualification_org_fk" FOREIGN KEY ("qualification_id","organization_id") REFERENCES "public"."employee_qualifications"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_supporting_sessions" ADD CONSTRAINT "qualification_supporting_sessions_session_org_fk" FOREIGN KEY ("session_id","organization_id") REFERENCES "public"."training_sessions"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_path_items" ADD CONSTRAINT "training_path_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_path_items" ADD CONSTRAINT "training_path_items_path_org_fk" FOREIGN KEY ("path_id","organization_id") REFERENCES "public"."training_paths"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_path_items" ADD CONSTRAINT "training_path_items_sop_org_fk" FOREIGN KEY ("sop_id","organization_id") REFERENCES "public"."sops"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_paths" ADD CONSTRAINT "training_paths_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_paths" ADD CONSTRAINT "training_paths_location_org_fk" FOREIGN KEY ("location_id","organization_id") REFERENCES "public"."locations"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_paths" ADD CONSTRAINT "training_paths_station_org_location_fk" FOREIGN KEY ("station_id","organization_id","location_id") REFERENCES "public"."stations"("id","organization_id","location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_paths" ADD CONSTRAINT "training_paths_definition_org_fk" FOREIGN KEY ("qualification_definition_id","organization_id") REFERENCES "public"."qualification_definitions"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_qualifications_active_employee_definition_uidx" ON "employee_qualifications" USING btree ("employee_id","definition_id") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "employee_qualifications_org_status_expiry_idx" ON "employee_qualifications" USING btree ("organization_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "employee_qualifications_employee_status_idx" ON "employee_qualifications" USING btree ("employee_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "qualification_definitions_org_name_uidx" ON "qualification_definitions" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "qualification_definitions_org_location_status_idx" ON "qualification_definitions" USING btree ("organization_id","location_id","status");--> statement-breakpoint
CREATE INDEX "qualification_supporting_sessions_qualification_idx" ON "qualification_supporting_sessions" USING btree ("qualification_id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_paths_org_location_title_uidx" ON "training_paths" USING btree ("organization_id","location_id","title");--> statement-breakpoint
CREATE INDEX "training_paths_org_location_status_idx" ON "training_paths" USING btree ("organization_id","location_id","status");