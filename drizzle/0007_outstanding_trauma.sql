CREATE TYPE "public"."training_explanation_policy" AS ENUM('never', 'on_incorrect', 'always');--> statement-breakpoint
CREATE TYPE "public"."training_mode" AS ENUM('learn', 'guided', 'test', 'demonstration');--> statement-breakpoint
CREATE TYPE "public"."training_question_placement" AS ENUM('before_step', 'after_step', 'final');--> statement-breakpoint
CREATE TYPE "public"."training_question_type" AS ENUM('single_choice', 'multiple_choice', 'true_false');--> statement-breakpoint
CREATE TYPE "public"."training_requirement_state" AS ENUM('disabled', 'optional', 'required');--> statement-breakpoint
CREATE TABLE "step_training_requirements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"step_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"require_full_video" boolean DEFAULT false NOT NULL,
	"require_confirmation" boolean DEFAULT false NOT NULL,
	"require_timer" boolean DEFAULT false NOT NULL,
	"require_question" boolean DEFAULT false NOT NULL,
	"require_photo" boolean DEFAULT false NOT NULL,
	"require_video" boolean DEFAULT false NOT NULL,
	"require_approval" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "step_training_requirements_step_uidx" UNIQUE("step_id"),
	CONSTRAINT "step_training_requirements_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "training_configs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sop_version_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"requirement_state" "training_requirement_state" DEFAULT 'disabled' NOT NULL,
	"default_mode" "training_mode" DEFAULT 'learn' NOT NULL,
	"allow_backtracking" boolean DEFAULT true NOT NULL,
	"require_sequential_progress" boolean DEFAULT true NOT NULL,
	"require_full_video_watch" boolean DEFAULT false NOT NULL,
	"require_evidence_approval" boolean DEFAULT true NOT NULL,
	"passing_score_percent" integer DEFAULT 80 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"qualification_validity_days" integer,
	"retraining_grace_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_configs_version_uidx" UNIQUE("sop_version_id"),
	CONSTRAINT "training_configs_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "training_question_choices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"question_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"text" text NOT NULL,
	"is_correct" boolean DEFAULT false NOT NULL,
	"display_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_questions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sop_version_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"step_id" uuid,
	"type" "training_question_type" NOT NULL,
	"text" text NOT NULL,
	"explanation" text DEFAULT '' NOT NULL,
	"points" integer DEFAULT 1 NOT NULL,
	"placement" "training_question_placement" NOT NULL,
	"display_order" integer NOT NULL,
	"explanation_policy" "training_explanation_policy" DEFAULT 'on_incorrect' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_questions_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "step_training_requirements" ADD CONSTRAINT "step_training_requirements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_training_requirements" ADD CONSTRAINT "step_training_requirements_step_org_fk" FOREIGN KEY ("step_id","organization_id") REFERENCES "public"."sop_steps"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_configs" ADD CONSTRAINT "training_configs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_configs" ADD CONSTRAINT "training_configs_version_org_fk" FOREIGN KEY ("sop_version_id","organization_id") REFERENCES "public"."sop_versions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_question_choices" ADD CONSTRAINT "training_question_choices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_question_choices" ADD CONSTRAINT "training_question_choices_question_org_fk" FOREIGN KEY ("question_id","organization_id") REFERENCES "public"."training_questions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_questions" ADD CONSTRAINT "training_questions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_questions" ADD CONSTRAINT "training_questions_version_org_fk" FOREIGN KEY ("sop_version_id","organization_id") REFERENCES "public"."sop_versions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_questions" ADD CONSTRAINT "training_questions_step_org_fk" FOREIGN KEY ("step_id","organization_id") REFERENCES "public"."sop_steps"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "training_question_choices_question_order_idx" ON "training_question_choices" USING btree ("question_id","display_order");--> statement-breakpoint
CREATE INDEX "training_questions_version_step_order_idx" ON "training_questions" USING btree ("sop_version_id","step_id","display_order");--> statement-breakpoint
ALTER TABLE "sop_steps" ADD CONSTRAINT "sop_steps_id_org_unique" UNIQUE("id","organization_id");