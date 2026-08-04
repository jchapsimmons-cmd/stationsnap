CREATE TYPE "public"."approval_submission_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."training_assignment_status" AS ENUM('assigned', 'in_progress', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."training_evidence_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."training_evidence_type" AS ENUM('photo', 'video');--> statement-breakpoint
CREATE TYPE "public"."training_session_status" AS ENUM('in_progress', 'awaiting_approval', 'passed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."training_step_progress_status" AS ENUM('pending', 'in_progress', 'completed');--> statement-breakpoint
CREATE TABLE "approval_submissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"submission_generation" integer DEFAULT 1 NOT NULL,
	"status" "approval_submission_status" DEFAULT 'pending' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_submissions_session_generation_uidx" UNIQUE("session_id","submission_generation")
);
--> statement-breakpoint
CREATE TABLE "training_answers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"selected_choice_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_correct" boolean DEFAULT false NOT NULL,
	"points_awarded" integer DEFAULT 0 NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_answers_session_question_uidx" UNIQUE("session_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "training_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"sop_version_id" uuid NOT NULL,
	"required_mode" "training_mode" NOT NULL,
	"status" "training_assignment_status" DEFAULT 'assigned' NOT NULL,
	"assigned_by_manager_user_id" uuid,
	"due_at" timestamp with time zone,
	"due_timezone" text,
	"retraining_generation" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_assignments_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "training_assignments_employee_version_generation_uidx" UNIQUE("employee_id","sop_version_id","retraining_generation")
);
--> statement-breakpoint
CREATE TABLE "training_evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"step_id" uuid,
	"file_id" uuid NOT NULL,
	"evidence_type" "training_evidence_type" NOT NULL,
	"submission_generation" integer DEFAULT 1 NOT NULL,
	"status" "training_evidence_status" DEFAULT 'pending' NOT NULL,
	"employee_note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_evidence_session_step_generation_uidx" UNIQUE("session_id","step_id","submission_generation")
);
--> statement-breakpoint
CREATE TABLE "training_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"mode" "training_mode" NOT NULL,
	"status" "training_session_status" DEFAULT 'in_progress' NOT NULL,
	"current_step_id" uuid,
	"score_percent" integer,
	"revision" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_resumed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_sessions_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "training_sessions_assignment_attempt_uidx" UNIQUE("assignment_id","attempt_number")
);
--> statement-breakpoint
CREATE TABLE "training_step_progress" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"status" "training_step_progress_status" DEFAULT 'pending' NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"video_watched_fully" boolean DEFAULT false NOT NULL,
	"timer_completed" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_step_progress_session_step_uidx" UNIQUE("session_id","step_id")
);
--> statement-breakpoint
ALTER TABLE "files" ALTER COLUMN "uploader_manager_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "uploader_employee_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_submissions" ADD CONSTRAINT "approval_submissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_submissions" ADD CONSTRAINT "approval_submissions_session_org_fk" FOREIGN KEY ("session_id","organization_id") REFERENCES "public"."training_sessions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_answers" ADD CONSTRAINT "training_answers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_answers" ADD CONSTRAINT "training_answers_session_org_fk" FOREIGN KEY ("session_id","organization_id") REFERENCES "public"."training_sessions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_answers" ADD CONSTRAINT "training_answers_question_org_fk" FOREIGN KEY ("question_id","organization_id") REFERENCES "public"."training_questions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_assigned_by_manager_user_id_manager_users_id_fk" FOREIGN KEY ("assigned_by_manager_user_id") REFERENCES "public"."manager_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_location_org_fk" FOREIGN KEY ("location_id","organization_id") REFERENCES "public"."locations"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_employee_org_location_fk" FOREIGN KEY ("employee_id","organization_id","location_id") REFERENCES "public"."employees"("id","organization_id","primary_location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_version_org_fk" FOREIGN KEY ("sop_version_id","organization_id") REFERENCES "public"."sop_versions"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_evidence" ADD CONSTRAINT "training_evidence_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_evidence" ADD CONSTRAINT "training_evidence_session_org_fk" FOREIGN KEY ("session_id","organization_id") REFERENCES "public"."training_sessions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_evidence" ADD CONSTRAINT "training_evidence_step_org_fk" FOREIGN KEY ("step_id","organization_id") REFERENCES "public"."sop_steps"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_evidence" ADD CONSTRAINT "training_evidence_file_org_fk" FOREIGN KEY ("file_id","organization_id") REFERENCES "public"."files"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_assignment_org_fk" FOREIGN KEY ("assignment_id","organization_id") REFERENCES "public"."training_assignments"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_current_step_org_fk" FOREIGN KEY ("current_step_id","organization_id") REFERENCES "public"."sop_steps"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_step_progress" ADD CONSTRAINT "training_step_progress_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_step_progress" ADD CONSTRAINT "training_step_progress_session_org_fk" FOREIGN KEY ("session_id","organization_id") REFERENCES "public"."training_sessions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_step_progress" ADD CONSTRAINT "training_step_progress_step_org_fk" FOREIGN KEY ("step_id","organization_id") REFERENCES "public"."sop_steps"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_submissions_org_status_idx" ON "approval_submissions" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "training_assignments_org_location_status_idx" ON "training_assignments" USING btree ("organization_id","location_id","status");--> statement-breakpoint
CREATE INDEX "training_assignments_employee_status_idx" ON "training_assignments" USING btree ("employee_id","status");--> statement-breakpoint
CREATE INDEX "training_evidence_session_idx" ON "training_evidence" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "training_sessions_assignment_status_idx" ON "training_sessions" USING btree ("assignment_id","status");--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploader_employee_org_fk" FOREIGN KEY ("uploader_employee_id","organization_id") REFERENCES "public"."employees"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploader_actor_check" CHECK ((uploader_manager_user_id is not null) <> (uploader_employee_id is not null));