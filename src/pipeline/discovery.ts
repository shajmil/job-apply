import { and, eq, or, sql } from 'drizzle-orm';
import { database } from '../db/client.js';
import { agentEvents, discoveredJobs, submittedApplications } from '../db/schema.js';
import { configuredSources } from '../sources/registry.js';
import { readBatch } from '../sources/job-source.js';
import { normalizeListing, normalizeText, similarDescription, extractApplicationEmail, experienceRange, experienceText, applyMethodFor } from './normalization.js';
import { hardFilter } from './deterministic-scoring.js';
import { audit, auditError } from '../logging/logger.js';
interface Identity { id: string; applyUrl: string; jobDescription: string; companyName: string; contentHash: string | null; normalizedFingerprint: string | null }
// The stored record for this exact source listing always wins over a similar listing from elsewhere.
// Otherwise a duplicate is the same listing URL, the same company/title/location with a substantially similar
// description, or the same company reposting an identical description under another title.
export function pickExisting<T extends Identity>(candidates: T[], listing: Identity): T | undefined {
 return candidates.find(x=>x.id===listing.id) ?? candidates.find(x=>x.applyUrl===listing.applyUrl
 || (x.normalizedFingerprint===listing.normalizedFingerprint&&similarDescription(x.jobDescription,listing.jobDescription))
 || (!!listing.contentHash&&x.contentHash===listing.contentHash&&normalizeText(x.companyName)===normalizeText(listing.companyName)));
}
export type NormalizedListing = ReturnType<typeof normalizeListing>;
export async function findExistingListing(j: NormalizedListing) {
 const candidates=await database.select().from(discoveredJobs).where(or(eq(discoveredJobs.id,j.id),eq(discoveredJobs.applyUrl,j.applyUrl),eq(discoveredJobs.normalizedFingerprint,j.normalizedFingerprint),eq(discoveredJobs.contentHash,j.contentHash)));
 return pickExisting(candidates,j);
}
// Stores a listing not seen before; clear eligibility exclusions are recorded immediately as skipped.
export async function storeNewListing(j: NormalizedListing, runId?: string, eventType='DISCOVERED'): Promise<string | null> {
 const now=new Date(), email=extractApplicationEmail(j.jobDescription), reason=hardFilter(j);
 await database.insert(discoveredJobs).values({...j,applyMethod:applyMethodFor(email),applyEmailAddress:email,experienceRequiredText:experienceText(experienceRange(j.jobDescription)),lastVerifiedAt:now,sourceLastSeenAt:now,skipReason:reason,applicationStatus:reason?'Skipped':'New'}).onConflictDoNothing();
 await audit(eventType,reason??'Active listing discovered',j.id,{skipReason:reason,source:j.sourceName},runId);
 return reason;
}
export async function runDiscoveryStage(runId: string) {
 let discovered=0, inserted=0, duplicates=0, hardFiltered=0, errors=0;
 for(const source of configuredSources()) { try {
 const batch=await readBatch(source), listings=batch.listings; discovered+=listings.length;
 await audit('SOURCE_FETCHED',`${listings.length} listings fetched`,undefined,{source:source.sourceName,slug:source.sourceSlug,listings:listings.length,ignoredByTitle:batch.ignored??0,failedDetails:batch.failedDetails??0,complete:batch.complete},runId);
 // One malformed or unstorable listing is audited without abandoning the rest of the board.
 for(const raw of listings) try {
 const j=normalizeListing(raw), now=new Date();
 const existing=await findExistingListing(j);
 const email=extractApplicationEmail(j.jobDescription);
 if(existing) {
 if(existing.id!==j.id) {
 duplicates++;
 // Record each duplicate listing once rather than on every run.
 const [known]=await database.select({id:agentEvents.id}).from(agentEvents).where(and(eq(agentEvents.eventType,'DUPLICATE'),eq(agentEvents.jobId,existing.id),sql`${agentEvents.metadata}->>'sourceJobId' = ${j.sourceJobId}`)).limit(1);
 if(!known) await audit('DUPLICATE','Similar listing already stored',existing.id,{source:source.sourceName,sourceJobId:j.sourceJobId},runId);
 continue;
 }
 const changed=existing.contentHash!==j.contentHash || existing.roleTitle!==j.roleTitle || existing.locationText!==j.locationText || existing.applyUrl!==j.applyUrl;
 const editable=['New','Waiting for approval','Skipped'].includes(existing.applicationStatus);
 const [reservation]=await database.select({id:submittedApplications.id}).from(submittedApplications).where(eq(submittedApplications.jobId,existing.id)).limit(1);
 const reopened=!existing.jobActive&&existing.skipReason==='JOB_CLOSED'&&existing.applicationStatus==='Skipped'&&!reservation;
 const resetForReview={applicationStatus:'New',skipReason:null,deterministicScore:null,semanticScore:null,finalScore:null,matchScore:null,confidence:null,matchReasoning:null,identifiedGaps:null,strengths:[],riskFlags:[],tailoredEmailBody:null,tailoredEmailSubject:null,tailoringPromptVersion:null,overrideScore:null,isReportedToUser:false,updatedAt:now};
 await database.update(discoveredJobs).set({lastSeenAt:now,sourceLastSeenAt:now,lastVerifiedAt:now,jobActive:true,closedAt:null,
 ...(reopened?{applicationStatus:'New',skipReason:null,updatedAt:now}:{}),
 ...(changed&&editable&&!reservation?{...resetForReview,roleTitle:j.roleTitle,locationText:j.locationText,normalizedLocation:j.normalizedLocation,workMode:j.workMode,detectedTechnologies:j.detectedTechnologies,salaryText:j.salaryText??null,experienceRequiredText:experienceText(experienceRange(j.jobDescription)),jobDescription:j.jobDescription,contentHash:j.contentHash,normalizedFingerprint:j.normalizedFingerprint,applyUrl:j.applyUrl,applyMethod:applyMethodFor(email),applyEmailAddress:email,companyDomain:j.companyDomain??null}:{})}).where(eq(discoveredJobs.id,existing.id));
 if(reopened) await audit('JOB_REOPENED','Listing reappeared on the ATS',existing.id,{},runId);
 if(changed) await audit('CONTENT_CHANGED',editable&&!reservation?'Source description changed; job returned to review':'Source description changed after application',existing.id,{},runId);
 continue;
 }
 const reason=await storeNewListing(j,runId);
 inserted++; if(reason) hardFiltered++;
 } catch(e) {errors++; await auditError('LISTING_ERROR',e,undefined,{source:source.sourceName,slug:source.sourceSlug,sourceJobId:raw.sourceJobId},runId);}
 // Only a completely read board is authoritative for disappearance; keyword-sampled sources never close listings here.
 const old=batch.complete?await database.select().from(discoveredJobs).where(and(eq(discoveredJobs.sourceName,source.sourceName),eq(discoveredJobs.sourceSlug,source.sourceSlug),eq(discoveredJobs.jobActive,true))):[];
 for(const j of old) if(j.sourceJobId&&!batch.seenIds.has(j.sourceJobId)) {
 const [reservation]=await database.select({id:submittedApplications.id}).from(submittedApplications).where(eq(submittedApplications.jobId,j.id)).limit(1);
 await database.update(discoveredJobs).set({jobActive:false,closedAt:new Date(),lastVerifiedAt:new Date(),...(['New','Waiting for approval'].includes(j.applicationStatus)&&!reservation?{applicationStatus:'Skipped',skipReason:'JOB_CLOSED'}:{})}).where(eq(discoveredJobs.id,j.id));
 await audit('JOB_CLOSED','Listing disappeared from ATS',j.id,{},runId);
 }
 } catch(e) {errors++; await auditError('SOURCE_FAILURE',e,undefined,{source:source.sourceName,slug:source.sourceSlug},runId);} }
 return {discovered,inserted,duplicates,hardFiltered,errors};
}
