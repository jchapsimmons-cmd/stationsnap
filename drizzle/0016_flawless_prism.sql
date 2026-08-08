ALTER TYPE "public"."notification_delivery_channel" ADD VALUE 'sms';--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "phone" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "sms_opt_in" boolean DEFAULT false NOT NULL;