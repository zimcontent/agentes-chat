-- Live Activities on iPhones (docs/adr/doug-0021-lock-screen.md): the run a person waits on, on their lock screen.
CREATE TABLE "live_activities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"token" text NOT NULL,
	"app_id" text,
	"apns_sandbox" boolean DEFAULT false NOT NULL,
	"locale" text NOT NULL,
	"state" jsonb,
	"sent_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "live_activities_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "live_activities" ADD CONSTRAINT "live_activities_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_activities" ADD CONSTRAINT "live_activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "live_activities_run_id_index" ON "live_activities" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "live_activities_open_idx" ON "live_activities" USING btree ("created_at") WHERE "live_activities"."ended_at" is null;
