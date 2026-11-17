-- A task holds the thread it was made from (ADR doug-0018): a channel's or a DM's conversation, one task per thread.
ALTER TABLE "issues" ADD COLUMN "thread_channel_id" uuid;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "thread_root_id" uuid;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_thread_channel_id_channels_id_fk" FOREIGN KEY ("thread_channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "issues_thread_root_id_index" ON "issues" USING btree ("thread_root_id");
