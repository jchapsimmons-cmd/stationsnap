CREATE TYPE "public"."sop_retraining_rule_type" AS ENUM('none', 'all_qualified', 'selected_roles', 'selected_locations');--> statement-breakpoint
CREATE TABLE "sop_retraining_rule_locations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"rule_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	CONSTRAINT "sop_retraining_rule_locations_rule_location_uidx" UNIQUE("rule_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "sop_retraining_rule_roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"rule_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"job_role" text NOT NULL,
	CONSTRAINT "sop_retraining_rule_roles_rule_role_uidx" UNIQUE("rule_id","job_role")
);
--> statement-breakpoint
CREATE TABLE "sop_retraining_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sop_version_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"rule_type" "sop_retraining_rule_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sop_retraining_rules_version_uidx" UNIQUE("sop_version_id"),
	CONSTRAINT "sop_retraining_rules_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "sop_versions" ADD COLUMN "change_summary" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sop_versions" ADD COLUMN "source_version_id" uuid;--> statement-breakpoint
ALTER TABLE "sop_retraining_rule_locations" ADD CONSTRAINT "sop_retraining_rule_locations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_retraining_rule_locations" ADD CONSTRAINT "sop_retraining_rule_locations_rule_org_fk" FOREIGN KEY ("rule_id","organization_id") REFERENCES "public"."sop_retraining_rules"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_retraining_rule_locations" ADD CONSTRAINT "sop_retraining_rule_locations_location_org_fk" FOREIGN KEY ("location_id","organization_id") REFERENCES "public"."locations"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_retraining_rule_roles" ADD CONSTRAINT "sop_retraining_rule_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_retraining_rule_roles" ADD CONSTRAINT "sop_retraining_rule_roles_rule_org_fk" FOREIGN KEY ("rule_id","organization_id") REFERENCES "public"."sop_retraining_rules"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_retraining_rules" ADD CONSTRAINT "sop_retraining_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_retraining_rules" ADD CONSTRAINT "sop_retraining_rules_version_org_fk" FOREIGN KEY ("sop_version_id","organization_id") REFERENCES "public"."sop_versions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_versions" ADD CONSTRAINT "sop_versions_source_version_sop_fk" FOREIGN KEY ("source_version_id","sop_id") REFERENCES "public"."sop_versions"("id","sop_id") ON DELETE set null ON UPDATE no action;