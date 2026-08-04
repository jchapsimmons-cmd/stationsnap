CREATE TYPE "public"."approval_decision_type" AS ENUM('approved', 'rejected', 'needs_correction');--> statement-breakpoint
ALTER TYPE "public"."approval_submission_status" ADD VALUE 'needs_correction';--> statement-breakpoint
CREATE TABLE "approval_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"decision" "approval_decision_type" NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"decided_by_manager_user_id" uuid NOT NULL,
	"pin_confirmation_audit_event_id" uuid,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_decisions_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "correction_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"replacement_generation" integer NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_submission_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "correction_requests_decision_uidx" UNIQUE("decision_id")
);
--> statement-breakpoint
ALTER TABLE "approval_submissions" ADD CONSTRAINT "approval_submissions_id_org_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_decided_by_manager_user_id_manager_users_id_fk" FOREIGN KEY ("decided_by_manager_user_id") REFERENCES "public"."manager_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_pin_confirmation_audit_event_id_audit_events_id_fk" FOREIGN KEY ("pin_confirmation_audit_event_id") REFERENCES "public"."audit_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_submission_org_fk" FOREIGN KEY ("submission_id","organization_id") REFERENCES "public"."approval_submissions"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_submission_org_fk" FOREIGN KEY ("submission_id","organization_id") REFERENCES "public"."approval_submissions"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_decision_org_fk" FOREIGN KEY ("decision_id","organization_id") REFERENCES "public"."approval_decisions"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_resolved_submission_org_fk" FOREIGN KEY ("resolved_submission_id","organization_id") REFERENCES "public"."approval_submissions"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_decisions_submission_decided_idx" ON "approval_decisions" USING btree ("submission_id","decided_at");--> statement-breakpoint
CREATE INDEX "approval_decisions_org_decided_idx" ON "approval_decisions" USING btree ("organization_id","decided_at");--> statement-breakpoint
CREATE UNIQUE INDEX "correction_requests_open_submission_uidx" ON "correction_requests" USING btree ("submission_id") WHERE resolved_at is null;--> statement-breakpoint
CREATE INDEX "correction_requests_org_submission_idx" ON "correction_requests" USING btree ("organization_id","submission_id");--> statement-breakpoint
CREATE INDEX "approval_submissions_org_status_submitted_idx" ON "approval_submissions" USING btree ("organization_id","status","submitted_at");