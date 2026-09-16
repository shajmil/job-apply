CREATE INDEX "event_job_index" ON "agent_events" USING btree ("job_id","event_type");--> statement-breakpoint
CREATE INDEX "event_type_time_index" ON "agent_events" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE INDEX "event_time_index" ON "agent_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "submitted_at_index" ON "submitted_applications" USING btree ("submitted_at");