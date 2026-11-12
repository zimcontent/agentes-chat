ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "display_name" text;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "icon" text;