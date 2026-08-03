CREATE TYPE "public"."qr_code_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."qr_scan_result" AS ENUM('resolved', 'revoked', 'unavailable', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."qr_target_type" AS ENUM('station', 'sop');--> statement-breakpoint
CREATE TABLE "qr_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"target_type" "qr_target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"token_hash" text NOT NULL,
	"status" "qr_code_status" DEFAULT 'active' NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_by_manager_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qr_codes_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "qr_scan_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"qr_code_id" uuid,
	"token_hash" text NOT NULL,
	"result" "qr_scan_result" NOT NULL,
	"employee_id" uuid,
	"ip_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sop_recent_views" (
	"id" uuid PRIMARY KEY NOT NULL,
	"employee_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"sop_id" uuid NOT NULL,
	"last_viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sop_recent_views_employee_sop_uidx" UNIQUE("employee_id","sop_id")
);
--> statement-breakpoint
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_created_by_manager_user_id_manager_users_id_fk" FOREIGN KEY ("created_by_manager_user_id") REFERENCES "public"."manager_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_location_org_fk" FOREIGN KEY ("location_id","organization_id") REFERENCES "public"."locations"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_scan_events" ADD CONSTRAINT "qr_scan_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_scan_events" ADD CONSTRAINT "qr_scan_events_qr_code_id_qr_codes_id_fk" FOREIGN KEY ("qr_code_id") REFERENCES "public"."qr_codes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_recent_views" ADD CONSTRAINT "sop_recent_views_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_recent_views" ADD CONSTRAINT "sop_recent_views_employee_org_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employees"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_recent_views" ADD CONSTRAINT "sop_recent_views_sop_org_fk" FOREIGN KEY ("sop_id","organization_id") REFERENCES "public"."sops"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "qr_codes_token_hash_uidx" ON "qr_codes" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "qr_codes_org_location_status_idx" ON "qr_codes" USING btree ("organization_id","location_id","status");--> statement-breakpoint
CREATE INDEX "qr_scan_events_qr_created_idx" ON "qr_scan_events" USING btree ("qr_code_id","created_at");--> statement-breakpoint
CREATE INDEX "qr_scan_events_token_created_idx" ON "qr_scan_events" USING btree ("token_hash","created_at");--> statement-breakpoint
CREATE INDEX "sop_recent_views_employee_viewed_idx" ON "sop_recent_views" USING btree ("employee_id","last_viewed_at");