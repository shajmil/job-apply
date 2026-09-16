import { pgTable, text, integer, timestamp, jsonb, boolean, uniqueIndex, index, doublePrecision } from 'drizzle-orm/pg-core';

export const discoveredJobs = pgTable(
  'discovered_jobs',
  {
    id: text('id').primaryKey(),
    sourceJobId: text('source_job_id'),
    sourceSlug: text('source_slug'),
    sourceUrl: text('source_url'),
    normalizedLocation: text('normalized_location'),
    normalizedFingerprint: text('normalized_fingerprint'),
    contentHash: text('content_hash'),
    jobActive: boolean('job_active').notNull().default(true),
    firstSeenAt: timestamp('first_seen_at').notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
    sourceLastSeenAt: timestamp('source_last_seen_at'),
    lastVerifiedAt: timestamp('last_verified_at'),
    closedAt: timestamp('closed_at'),
    deterministicScore: integer('deterministic_score'),
    semanticScore: integer('semantic_score'),
    finalScore: doublePrecision('final_score'),
    confidence: integer('confidence'),
    strengths: jsonb('strengths').$type<string[]>().default([]),
    riskFlags: jsonb('risk_flags').$type<string[]>().default([]),
    skipReason: text('skip_reason'),
    scoringModel: text('scoring_model'),
    scoringPromptVersion: text('scoring_prompt_version'),
    tailoringPromptVersion: text('tailoring_prompt_version'),
    screeningPromptVersion: text('screening_prompt_version'),
    screeningData: jsonb('screening_data').$type<Array<{question: string; classification: string; answer?: string}>>().default([]),
    llmInputTokens: integer('llm_input_tokens').notNull().default(0),
    llmOutputTokens: integer('llm_output_tokens').notNull().default(0),
    llmCost: doublePrecision('llm_cost').notNull().default(0),
    originalScore: doublePrecision('original_score'),
    overrideScore: integer('override_score'),
    overrideReason: text('override_reason'),
    overriddenBy: text('overridden_by'),
    overriddenAt: timestamp('overridden_at'),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    sourceName: text('source_name').notNull(),
    companyName: text('company_name').notNull(),
    // Employer website domain as published by the source; confirms an application mailbox belongs to the employer.
    companyDomain: text('company_domain'),
    roleTitle: text('role_title').notNull(),
    locationText: text('location_text'),
    workMode: text('work_mode'),
    salaryText: text('salary_text'),
    experienceRequiredText: text('experience_required_text'),
    jobDescription: text('job_description').notNull(),
    detectedTechnologies: jsonb('detected_technologies').$type<string[]>().default([]),
    applyMethod: text('apply_method').notNull(),
    applyEmailAddress: text('apply_email_address'),
    applyUrl: text('apply_url').notNull(),
    matchScore: integer('match_score'),
    matchReasoning: text('match_reasoning'),
    identifiedGaps: text('identified_gaps'),
    tailoredEmailSubject: text('tailored_email_subject'),
    tailoredEmailBody: text('tailored_email_body'),
    applicationStatus: text('application_status').notNull().default('New'),
    isReportedToUser: boolean('is_reported_to_user').notNull().default(false),
    discoveredAt: timestamp('discovered_at').notNull().defaultNow(),
    postedAtText: text('posted_at_text')
  },
  table => ({
    queueIndex: index('queue_index').on(table.applicationStatus, table.matchScore),
    fingerprintIndex: index('fingerprint_index').on(table.normalizedFingerprint),
    contentIndex: index('content_index').on(table.contentHash),
    sourceIdIndex: uniqueIndex('source_id_index').on(table.sourceName, table.sourceSlug, table.sourceJobId),
    uniqueSourceListing: uniqueIndex('unique_source_listing').on(table.sourceName, table.applyUrl)
  })
);

export const submittedApplications = pgTable('submitted_applications', {
  id: text('id').primaryKey(),
  jobId: text('job_id').unique()
    .notNull()
    .references(() => discoveredJobs.id),
  deliveryChannel: text('delivery_channel').notNull(),
  recipientAddress: text('recipient_address'),
  providerMessageId: text('provider_message_id'),
  approvedByUserAt: timestamp('approved_by_user_at'),
  submittedAt: timestamp('submitted_at').notNull().defaultNow(),
  responseReceivedAt: timestamp('response_received_at'),
  notes: text('notes'),
  outcomeStatus: text('outcome_status').notNull().default('Applied')
}, table => ({
  submittedAtIndex: index('submitted_at_index').on(table.submittedAt)
}));

export type DiscoveredJobRecord = typeof discoveredJobs.$inferSelect;
export type NewDiscoveredJobRecord = typeof discoveredJobs.$inferInsert;
export type SubmittedApplicationRecord = typeof submittedApplications.$inferSelect;

export const agentRuns = pgTable('agent_runs', {
 id: text('id').primaryKey(), startedAt: timestamp('started_at').notNull().defaultNow(), completedAt: timestamp('completed_at'),
 status: text('status').notNull().default('Running'), jobsDiscovered: integer('jobs_discovered').default(0), jobsNew: integer('jobs_new').default(0),
 jobsScored: integer('jobs_scored').default(0), jobsQualified: integer('jobs_qualified').default(0), jobsSkipped: integer('jobs_skipped').default(0),
 applicationsSent: integer('applications_sent').default(0), errors: integer('errors').default(0), durationMs: integer('duration_ms')
});
export const agentEvents = pgTable('agent_events', {
 id: text('id').primaryKey(), runId: text('run_id').references(() => agentRuns.id), jobId: text('job_id').references(() => discoveredJobs.id),
 eventType: text('event_type').notNull(), message: text('message').notNull(), metadata: jsonb('metadata'), createdAt: timestamp('created_at').notNull().defaultNow()
}, table => ({
 eventJobIndex: index('event_job_index').on(table.jobId, table.eventType),
 eventTypeTimeIndex: index('event_type_time_index').on(table.eventType, table.createdAt),
 eventTimeIndex: index('event_time_index').on(table.createdAt)
}));
