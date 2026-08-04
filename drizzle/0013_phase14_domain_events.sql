CREATE TYPE "public"."domain_event_processing_status" AS ENUM('pending', 'processed');--> statement-breakpoint
CREATE TABLE "domain_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid,
	"type" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processing_status" "domain_event_processing_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_location_org_fk" FOREIGN KEY ("location_id","organization_id") REFERENCES "public"."locations"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "domain_events_org_occurred_idx" ON "domain_events" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "domain_events_org_location_occurred_idx" ON "domain_events" USING btree ("organization_id","location_id","occurred_at");--> statement-breakpoint
CREATE INDEX "domain_events_org_type_occurred_idx" ON "domain_events" USING btree ("organization_id","type","occurred_at");--> statement-breakpoint
CREATE INDEX "domain_events_processing_status_idx" ON "domain_events" USING btree ("processing_status");