CREATE TYPE "public"."ai_sop_job_failed_step" AS ENUM('transcribing', 'drafting');--> statement-breakpoint
CREATE TYPE "public"."ai_sop_job_output_acceptance" AS ENUM('pending', 'applied', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."ai_sop_job_status" AS ENUM('upload_received', 'transcribing', 'drafting', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ai_sop_job_type" AS ENUM('video_to_draft');--> statement-breakpoint
CREATE TABLE "ai_sop_job_outputs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"schema_version" integer NOT NULL,
	"structured_draft" jsonb NOT NULL,
	"acceptance_state" "ai_sop_job_output_acceptance" DEFAULT 'pending' NOT NULL,
	"applied_at" timestamp with time zone,
	"applied_by_manager_user_id" uuid,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_sop_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"job_type" "ai_sop_job_type" DEFAULT 'video_to_draft' NOT NULL,
	"sop_id" uuid NOT NULL,
	"source_file_id" uuid NOT NULL,
	"status" "ai_sop_job_status" DEFAULT 'upload_received' NOT NULL,
	"failed_step" "ai_sop_job_failed_step",
	"transcript" text DEFAULT '' NOT NULL,
	"transcript_provider" text DEFAULT '' NOT NULL,
	"transcript_model" text DEFAULT '' NOT NULL,
	"draft_provider" text DEFAULT '' NOT NULL,
	"draft_model" text DEFAULT '' NOT NULL,
	"draft_schema_version" integer,
	"step_attempts" integer DEFAULT 0 NOT NULL,
	"max_step_attempts" integer DEFAULT 5 NOT NULL,
	"last_error_code" text DEFAULT '' NOT NULL,
	"last_error_message" text DEFAULT '' NOT NULL,
	"claimed_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_manager_user_id" uuid NOT NULL,
	"ready_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_sop_jobs_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "ai_sop_job_outputs" ADD CONSTRAINT "ai_sop_job_outputs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_sop_job_outputs" ADD CONSTRAINT "ai_sop_job_outputs_applied_by_manager_user_id_manager_users_id_fk" FOREIGN KEY ("applied_by_manager_user_id") REFERENCES "public"."manager_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_sop_job_outputs" ADD CONSTRAINT "ai_sop_job_outputs_job_org_fk" FOREIGN KEY ("job_id","organization_id") REFERENCES "public"."ai_sop_jobs"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_sop_jobs" ADD CONSTRAINT "ai_sop_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_sop_jobs" ADD CONSTRAINT "ai_sop_jobs_created_by_manager_user_id_manager_users_id_fk" FOREIGN KEY ("created_by_manager_user_id") REFERENCES "public"."manager_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_sop_jobs" ADD CONSTRAINT "ai_sop_jobs_location_org_fk" FOREIGN KEY ("location_id","organization_id") REFERENCES "public"."locations"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_sop_jobs" ADD CONSTRAINT "ai_sop_jobs_sop_org_fk" FOREIGN KEY ("sop_id","organization_id") REFERENCES "public"."sops"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_sop_jobs" ADD CONSTRAINT "ai_sop_jobs_source_file_org_fk" FOREIGN KEY ("source_file_id","organization_id") REFERENCES "public"."files"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_sop_job_outputs_job_idx" ON "ai_sop_job_outputs" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_sop_job_outputs_org_state_idx" ON "ai_sop_job_outputs" USING btree ("organization_id","acceptance_state");--> statement-breakpoint
CREATE INDEX "ai_sop_jobs_org_location_status_idx" ON "ai_sop_jobs" USING btree ("organization_id","location_id","status");--> statement-breakpoint
CREATE INDEX "ai_sop_jobs_sop_idx" ON "ai_sop_jobs" USING btree ("sop_id");--> statement-breakpoint
CREATE INDEX "ai_sop_jobs_status_next_attempt_idx" ON "ai_sop_jobs" USING btree ("status","next_attempt_at");