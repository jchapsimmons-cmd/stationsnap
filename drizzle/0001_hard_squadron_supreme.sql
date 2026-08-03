CREATE TYPE "public"."actor_type" AS ENUM('manager', 'employee', 'system', 'anonymous');--> statement-breakpoint
CREATE TYPE "public"."login_outcome" AS ENUM('success', 'failure', 'locked', 'disabled');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"location_id" uuid,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_rate_limits" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"actor_type" "actor_type" NOT NULL,
	"subject_hash" text NOT NULL,
	"ip_hash" text NOT NULL,
	"outcome" "login_outcome" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manager_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"manager_user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"manager_user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" DROP CONSTRAINT "employees_primary_location_id_locations_id_fk";
--> statement-breakpoint
ALTER TABLE "manager_location_access" DROP CONSTRAINT "manager_location_access_membership_id_manager_memberships_id_fk";
--> statement-breakpoint
ALTER TABLE "manager_location_access" DROP CONSTRAINT "manager_location_access_location_id_locations_id_fk";
--> statement-breakpoint
ALTER TABLE "stations" DROP CONSTRAINT "stations_location_id_locations_id_fk";
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "pin_hash" text;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "access_slug" text;--> statement-breakpoint
ALTER TABLE "manager_users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "access_slug" text;--> statement-breakpoint
UPDATE "organizations" SET "access_slug" = 'organization-' || left("id"::text, 8) WHERE "access_slug" IS NULL;--> statement-breakpoint
UPDATE "locations" SET "access_slug" = 'location-' || left("id"::text, 8) WHERE "access_slug" IS NULL;--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "access_slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" ALTER COLUMN "access_slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_id_org_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_id_org_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "manager_memberships" ADD CONSTRAINT "manager_memberships_id_org_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_sessions" ADD CONSTRAINT "employee_sessions_employee_org_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employees"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_sessions" ADD CONSTRAINT "employee_sessions_location_org_fk" FOREIGN KEY ("location_id","organization_id") REFERENCES "public"."locations"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_attempts" ADD CONSTRAINT "login_attempts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_sessions" ADD CONSTRAINT "manager_sessions_manager_user_id_manager_users_id_fk" FOREIGN KEY ("manager_user_id") REFERENCES "public"."manager_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_sessions" ADD CONSTRAINT "manager_sessions_membership_org_fk" FOREIGN KEY ("membership_id","organization_id") REFERENCES "public"."manager_memberships"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_manager_user_id_manager_users_id_fk" FOREIGN KEY ("manager_user_id") REFERENCES "public"."manager_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_org_created_idx" ON "audit_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_action_created_idx" ON "audit_events" USING btree ("action","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_sessions_token_hash_uidx" ON "employee_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "employee_sessions_employee_expiry_idx" ON "employee_sessions" USING btree ("employee_id","expires_at");--> statement-breakpoint
CREATE INDEX "login_attempts_subject_created_idx" ON "login_attempts" USING btree ("subject_hash","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "manager_sessions_token_hash_uidx" ON "manager_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "manager_sessions_user_expiry_idx" ON "manager_sessions" USING btree ("manager_user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_hash_uidx" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_expiry_idx" ON "password_reset_tokens" USING btree ("manager_user_id","expires_at");--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_location_org_fk" FOREIGN KEY ("primary_location_id","organization_id") REFERENCES "public"."locations"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_location_access" ADD CONSTRAINT "manager_location_access_membership_org_fk" FOREIGN KEY ("membership_id","organization_id") REFERENCES "public"."manager_memberships"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_location_access" ADD CONSTRAINT "manager_location_access_location_org_fk" FOREIGN KEY ("location_id","organization_id") REFERENCES "public"."locations"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stations" ADD CONSTRAINT "stations_location_org_fk" FOREIGN KEY ("location_id","organization_id") REFERENCES "public"."locations"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "locations_org_slug_uidx" ON "locations" USING btree ("organization_id","access_slug");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_access_slug_uidx" ON "organizations" USING btree ("access_slug");--> statement-breakpoint
