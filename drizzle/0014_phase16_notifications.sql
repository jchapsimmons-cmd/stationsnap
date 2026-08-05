CREATE TYPE "public"."notification_delivery_channel" AS ENUM('in_app', 'email');--> statement-breakpoint
CREATE TYPE "public"."notification_delivery_status" AS ENUM('sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."notification_recipient_type" AS ENUM('manager', 'employee');--> statement-breakpoint
CREATE TYPE "public"."scheduled_job_run_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"notification_id" uuid NOT NULL,
	"channel" "notification_delivery_channel" NOT NULL,
	"recipient_address" text DEFAULT '' NOT NULL,
	"status" "notification_delivery_status" NOT NULL,
	"error_code" text DEFAULT '' NOT NULL,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_notification_channel_uidx" UNIQUE("notification_id","channel")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid,
	"recipient_type" "notification_recipient_type" NOT NULL,
	"recipient_id" uuid NOT NULL,
	"type" text NOT NULL,
	"subject_type" text DEFAULT '' NOT NULL,
	"subject_id" uuid,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"internal_path" text DEFAULT '' NOT NULL,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "scheduled_job_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_type" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"time_bucket" text NOT NULL,
	"status" "scheduled_job_run_status" DEFAULT 'running' NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_org_fk" FOREIGN KEY ("notification_id","organization_id") REFERENCES "public"."notifications"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_location_org_fk" FOREIGN KEY ("location_id","organization_id") REFERENCES "public"."locations"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_job_runs" ADD CONSTRAINT "scheduled_job_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_deliveries_org_status_idx" ON "notification_deliveries" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_key_uidx" ON "notifications" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_recipient_read_created_idx" ON "notifications" USING btree ("recipient_type","recipient_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "notifications_org_recipient_created_idx" ON "notifications" USING btree ("organization_id","recipient_type","recipient_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_job_runs_type_org_bucket_uidx" ON "scheduled_job_runs" USING btree ("job_type","organization_id","time_bucket");--> statement-breakpoint
CREATE INDEX "scheduled_job_runs_org_status_idx" ON "scheduled_job_runs" USING btree ("organization_id","status");