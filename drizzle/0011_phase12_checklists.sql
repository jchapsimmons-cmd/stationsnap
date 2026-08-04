CREATE TYPE "public"."checklist_approval_decision_type" AS ENUM('approved', 'rejected', 'needs_correction');--> statement-breakpoint
CREATE TYPE "public"."checklist_approval_submission_status" AS ENUM('pending', 'approved', 'rejected', 'needs_correction');--> statement-breakpoint
CREATE TYPE "public"."checklist_evidence_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."checklist_evidence_type" AS ENUM('photo');--> statement-breakpoint
CREATE TYPE "public"."checklist_item_progress_status" AS ENUM('pending', 'in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "public"."checklist_recurrence_type" AS ENUM('once', 'daily', 'weekly');--> statement-breakpoint
CREATE TYPE "public"."checklist_run_status" AS ENUM('in_progress', 'awaiting_approval', 'submitted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."checklist_type" AS ENUM('opening', 'closing', 'cleaning', 'prep', 'custom');--> statement-breakpoint
CREATE TABLE "checklist_approval_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"decision" "checklist_approval_decision_type" NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"decided_by_manager_user_id" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_approval_decisions_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "checklist_approval_submissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"submission_generation" integer DEFAULT 1 NOT NULL,
	"status" "checklist_approval_submission_status" DEFAULT 'pending' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_approval_submissions_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "checklist_approval_submissions_run_generation_uidx" UNIQUE("run_id","submission_generation")
);
--> statement-breakpoint
CREATE TABLE "checklist_correction_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"replacement_generation" integer NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_submission_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_correction_requests_decision_uidx" UNIQUE("decision_id")
);
--> statement-breakpoint
CREATE TABLE "checklist_evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"progress_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"evidence_type" "checklist_evidence_type" DEFAULT 'photo' NOT NULL,
	"submission_generation" integer DEFAULT 1 NOT NULL,
	"status" "checklist_evidence_status" DEFAULT 'pending' NOT NULL,
	"employee_note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_evidence_progress_generation_uidx" UNIQUE("progress_id","submission_generation")
);
--> statement-breakpoint
CREATE TABLE "checklist_item_progress" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"status" "checklist_item_progress_status" DEFAULT 'pending' NOT NULL,
	"timer_completed" boolean DEFAULT false NOT NULL,
	"employee_note" text DEFAULT '' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_item_progress_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "checklist_item_progress_run_item_uidx" UNIQUE("run_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "checklist_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"checklist_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"display_order" integer NOT NULL,
	"title" text NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"timer_seconds" integer,
	"require_photo" boolean DEFAULT false NOT NULL,
	"require_approval" boolean DEFAULT false NOT NULL,
	"require_note" boolean DEFAULT false NOT NULL,
	"reference_file_id" uuid,
	"status" "record_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_items_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "checklist_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"checklist_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"occurrence_key" text NOT NULL,
	"status" "checklist_run_status" DEFAULT 'in_progress' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_resumed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_runs_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "checklists" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"station_id" uuid,
	"type" "checklist_type" NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"recurrence_type" "checklist_recurrence_type" DEFAULT 'once' NOT NULL,
	"status" "record_status" DEFAULT 'active' NOT NULL,
	"created_by_manager_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklists_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "checklist_approval_decisions" ADD CONSTRAINT "checklist_approval_decisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_approval_decisions" ADD CONSTRAINT "checklist_approval_decisions_decided_by_manager_user_id_manager_users_id_fk" FOREIGN KEY ("decided_by_manager_user_id") REFERENCES "public"."manager_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_approval_decisions" ADD CONSTRAINT "checklist_approval_decisions_submission_org_fk" FOREIGN KEY ("submission_id","organization_id") REFERENCES "public"."checklist_approval_submissions"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_approval_submissions" ADD CONSTRAINT "checklist_approval_submissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_approval_submissions" ADD CONSTRAINT "checklist_approval_submissions_run_org_fk" FOREIGN KEY ("run_id","organization_id") REFERENCES "public"."checklist_runs"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_correction_requests" ADD CONSTRAINT "checklist_correction_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_correction_requests" ADD CONSTRAINT "checklist_correction_requests_submission_org_fk" FOREIGN KEY ("submission_id","organization_id") REFERENCES "public"."checklist_approval_submissions"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_correction_requests" ADD CONSTRAINT "checklist_correction_requests_decision_org_fk" FOREIGN KEY ("decision_id","organization_id") REFERENCES "public"."checklist_approval_decisions"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_correction_requests" ADD CONSTRAINT "checklist_correction_requests_resolved_submission_org_fk" FOREIGN KEY ("resolved_submission_id","organization_id") REFERENCES "public"."checklist_approval_submissions"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_evidence" ADD CONSTRAINT "checklist_evidence_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_evidence" ADD CONSTRAINT "checklist_evidence_progress_org_fk" FOREIGN KEY ("progress_id","organization_id") REFERENCES "public"."checklist_item_progress"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_evidence" ADD CONSTRAINT "checklist_evidence_file_org_fk" FOREIGN KEY ("file_id","organization_id") REFERENCES "public"."files"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_item_progress" ADD CONSTRAINT "checklist_item_progress_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_item_progress" ADD CONSTRAINT "checklist_item_progress_run_org_fk" FOREIGN KEY ("run_id","organization_id") REFERENCES "public"."checklist_runs"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_item_progress" ADD CONSTRAINT "checklist_item_progress_item_org_fk" FOREIGN KEY ("item_id","organization_id") REFERENCES "public"."checklist_items"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_checklist_org_fk" FOREIGN KEY ("checklist_id","organization_id") REFERENCES "public"."checklists"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_reference_file_org_fk" FOREIGN KEY ("reference_file_id","organization_id") REFERENCES "public"."files"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_runs" ADD CONSTRAINT "checklist_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_runs" ADD CONSTRAINT "checklist_runs_location_org_fk" FOREIGN KEY ("location_id","organization_id") REFERENCES "public"."locations"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_runs" ADD CONSTRAINT "checklist_runs_checklist_org_fk" FOREIGN KEY ("checklist_id","organization_id") REFERENCES "public"."checklists"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_runs" ADD CONSTRAINT "checklist_runs_employee_org_location_fk" FOREIGN KEY ("employee_id","organization_id","location_id") REFERENCES "public"."employees"("id","organization_id","primary_location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_created_by_manager_user_id_manager_users_id_fk" FOREIGN KEY ("created_by_manager_user_id") REFERENCES "public"."manager_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_location_org_fk" FOREIGN KEY ("location_id","organization_id") REFERENCES "public"."locations"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_station_org_location_fk" FOREIGN KEY ("station_id","organization_id","location_id") REFERENCES "public"."stations"("id","organization_id","location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checklist_approval_decisions_submission_decided_idx" ON "checklist_approval_decisions" USING btree ("submission_id","decided_at");--> statement-breakpoint
CREATE INDEX "checklist_approval_decisions_org_decided_idx" ON "checklist_approval_decisions" USING btree ("organization_id","decided_at");--> statement-breakpoint
CREATE INDEX "checklist_approval_submissions_org_status_idx" ON "checklist_approval_submissions" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "checklist_approval_submissions_org_status_submitted_idx" ON "checklist_approval_submissions" USING btree ("organization_id","status","submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "checklist_correction_requests_open_submission_uidx" ON "checklist_correction_requests" USING btree ("submission_id") WHERE resolved_at is null;--> statement-breakpoint
CREATE INDEX "checklist_correction_requests_org_submission_idx" ON "checklist_correction_requests" USING btree ("organization_id","submission_id");--> statement-breakpoint
CREATE INDEX "checklist_evidence_progress_idx" ON "checklist_evidence" USING btree ("progress_id");--> statement-breakpoint
CREATE INDEX "checklist_item_progress_run_idx" ON "checklist_item_progress" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "checklist_items_checklist_order_idx" ON "checklist_items" USING btree ("checklist_id","display_order");--> statement-breakpoint
CREATE INDEX "checklist_items_checklist_status_idx" ON "checklist_items" USING btree ("checklist_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "checklist_runs_checklist_employee_occurrence_uidx" ON "checklist_runs" USING btree ("checklist_id","employee_id","occurrence_key") WHERE status <> 'rejected';--> statement-breakpoint
CREATE INDEX "checklist_runs_org_location_status_idx" ON "checklist_runs" USING btree ("organization_id","location_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "checklist_runs_employee_status_idx" ON "checklist_runs" USING btree ("employee_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "checklists_org_location_title_uidx" ON "checklists" USING btree ("organization_id","location_id","title");--> statement-breakpoint
CREATE INDEX "checklists_org_location_status_idx" ON "checklists" USING btree ("organization_id","location_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "checklists_org_station_idx" ON "checklists" USING btree ("organization_id","station_id");