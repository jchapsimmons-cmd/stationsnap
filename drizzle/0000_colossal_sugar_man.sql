CREATE TYPE "public"."membership_role" AS ENUM('owner', 'manager');--> statement-breakpoint
CREATE TYPE "public"."preferred_language" AS ENUM('en', 'es');--> statement-breakpoint
CREATE TYPE "public"."record_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"primary_location_id" uuid NOT NULL,
	"employee_number" text NOT NULL,
	"display_name" text NOT NULL,
	"job_role" text NOT NULL,
	"preferred_language" "preferred_language" DEFAULT 'en' NOT NULL,
	"status" "record_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"status" "record_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manager_location_access" (
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manager_location_access_membership_id_location_id_pk" PRIMARY KEY("membership_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "manager_memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"manager_user_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"status" "record_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manager_users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"status" "record_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manager_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"default_language" "preferred_language" DEFAULT 'en' NOT NULL,
	"timezone" text NOT NULL,
	"status" "record_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"display_order" integer NOT NULL,
	"status" "record_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_primary_location_id_locations_id_fk" FOREIGN KEY ("primary_location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_location_access" ADD CONSTRAINT "manager_location_access_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_location_access" ADD CONSTRAINT "manager_location_access_membership_id_manager_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."manager_memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_location_access" ADD CONSTRAINT "manager_location_access_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_memberships" ADD CONSTRAINT "manager_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_memberships" ADD CONSTRAINT "manager_memberships_manager_user_id_manager_users_id_fk" FOREIGN KEY ("manager_user_id") REFERENCES "public"."manager_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stations" ADD CONSTRAINT "stations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stations" ADD CONSTRAINT "stations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employees_org_number_uidx" ON "employees" USING btree ("organization_id","employee_number");--> statement-breakpoint
CREATE INDEX "employees_org_location_status_idx" ON "employees" USING btree ("organization_id","primary_location_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_org_name_uidx" ON "locations" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "locations_org_status_idx" ON "locations" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "manager_location_access_org_location_idx" ON "manager_location_access" USING btree ("organization_id","location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manager_memberships_org_user_uidx" ON "manager_memberships" USING btree ("organization_id","manager_user_id");--> statement-breakpoint
CREATE INDEX "manager_memberships_org_status_idx" ON "manager_memberships" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "organizations_status_idx" ON "organizations" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "stations_location_name_uidx" ON "stations" USING btree ("location_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "stations_location_order_uidx" ON "stations" USING btree ("location_id","display_order");--> statement-breakpoint
CREATE INDEX "stations_org_location_status_idx" ON "stations" USING btree ("organization_id","location_id","status");