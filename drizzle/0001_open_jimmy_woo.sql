ALTER TABLE "conversations" ADD COLUMN "revived_alert_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "human_took_over_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" text;