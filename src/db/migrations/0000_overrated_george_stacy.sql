CREATE TABLE IF NOT EXISTS "agent_events" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text,
	"job_id" text,
	"event_type" text NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"status" text DEFAULT 'Running' NOT NULL,
	"jobs_discovered" integer DEFAULT 0,
	"jobs_new" integer DEFAULT 0,
	"jobs_scored" integer DEFAULT 0,
	"jobs_qualified" integer DEFAULT 0,
	"jobs_skipped" integer DEFAULT 0,
	"applications_sent" integer DEFAULT 0,
	"errors" integer DEFAULT 0,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "discovered_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"source_job_id" text,
	"source_slug" text,
	"source_url" text,
	"normalized_location" text,
	"normalized_fingerprint" text,
	"content_hash" text,
	"job_active" boolean DEFAULT true NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"source_last_seen_at" timestamp,
	"last_verified_at" timestamp,
	"closed_at" timestamp,
	"deterministic_score" integer,
	"semantic_score" integer,
	"final_score" double precision,
	"confidence" integer,
	"strengths" jsonb DEFAULT '[]'::jsonb,
	"risk_flags" jsonb DEFAULT '[]'::jsonb,
	"skip_reason" text,
	"scoring_model" text,
	"scoring_prompt_version" text,
	"tailoring_prompt_version" text,
	"screening_prompt_version" text,
	"screening_data" jsonb DEFAULT '[]'::jsonb,
	"llm_input_tokens" integer DEFAULT 0 NOT NULL,
	"llm_output_tokens" integer DEFAULT 0 NOT NULL,
	"llm_cost" double precision DEFAULT 0 NOT NULL,
	"original_score" double precision,
	"override_score" integer,
	"override_reason" text,
	"overridden_by" text,
	"overridden_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"source_name" text NOT NULL,
	"company_name" text NOT NULL,
	"role_title" text NOT NULL,
	"location_text" text,
	"work_mode" text,
	"salary_text" text,
	"experience_required_text" text,
	"job_description" text NOT NULL,
	"detected_technologies" jsonb DEFAULT '[]'::jsonb,
	"apply_method" text NOT NULL,
	"apply_email_address" text,
	"apply_url" text NOT NULL,
	"match_score" integer,
	"match_reasoning" text,
	"identified_gaps" text,
	"tailored_email_subject" text,
	"tailored_email_body" text,
	"application_status" text DEFAULT 'New' NOT NULL,
	"is_reported_to_user" boolean DEFAULT false NOT NULL,
	"discovered_at" timestamp DEFAULT now() NOT NULL,
	"posted_at_text" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "submitted_applications" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"delivery_channel" text NOT NULL,
	"recipient_address" text,
	"provider_message_id" text,
	"approved_by_user_at" timestamp,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"response_received_at" timestamp,
	"notes" text,
	"outcome_status" text DEFAULT 'Applied' NOT NULL,
	CONSTRAINT "submitted_applications_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_job_id_discovered_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."discovered_jobs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "submitted_applications" ADD CONSTRAINT "submitted_applications_job_id_discovered_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."discovered_jobs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "queue_index" ON "discovered_jobs" USING btree ("application_status","match_score");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fingerprint_index" ON "discovered_jobs" USING btree ("normalized_fingerprint");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_index" ON "discovered_jobs" USING btree ("content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "source_id_index" ON "discovered_jobs" USING btree ("source_name","source_slug","source_job_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unique_source_listing" ON "discovered_jobs" USING btree ("source_name","apply_url");