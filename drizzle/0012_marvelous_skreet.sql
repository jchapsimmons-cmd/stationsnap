CREATE TYPE "public"."translation_entity_type" AS ENUM('sop_version', 'sop_material', 'sop_warning', 'sop_step');--> statement-breakpoint
CREATE TYPE "public"."translation_field" AS ENUM('title', 'description', 'name', 'text', 'instruction', 'warning');--> statement-breakpoint
CREATE TYPE "public"."translation_provider" AS ENUM('manual', 'ai');--> statement-breakpoint
CREATE TYPE "public"."translation_status" AS ENUM('pending_review', 'approved');--> statement-breakpoint
CREATE TABLE "translations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"entity_type" "translation_entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"field" "translation_field" NOT NULL,
	"source_locale" "preferred_language" NOT NULL,
	"target_locale" "preferred_language" NOT NULL,
	"source_text_hash" text NOT NULL,
	"translated_text" text DEFAULT '' NOT NULL,
	"status" "translation_status" DEFAULT 'pending_review' NOT NULL,
	"provider" "translation_provider" DEFAULT 'manual' NOT NULL,
	"reviewer_manager_user_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "translations_entity_field_target_uidx" UNIQUE("entity_id","field","target_locale"),
	CONSTRAINT "translations_source_target_locale_differ" CHECK ("translations"."source_locale" <> "translations"."target_locale")
);
--> statement-breakpoint
ALTER TABLE "translations" ADD CONSTRAINT "translations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translations" ADD CONSTRAINT "translations_reviewer_manager_user_id_manager_users_id_fk" FOREIGN KEY ("reviewer_manager_user_id") REFERENCES "public"."manager_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "translations_org_entity_idx" ON "translations" USING btree ("organization_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "translations_org_status_idx" ON "translations" USING btree ("organization_id","status");