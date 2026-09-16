import { and, eq, inArray, isNull, notExists } from 'drizzle-orm';
import { database } from '../db/client.js';
import { discoveredJobs, submittedApplications } from '../db/schema.js';
import { normalizeListing, experienceRange, experienceText, extractApplicationEmail, applyMethodFor } from './normalization.js';
import { runScoringStage } from './scoring.js';
import { audit } from '../logging/logger.js';
// Rule-based skips are re-evaluated after filtering or scoring rules change. User skips, closed listings and jobs
// user overrides and submitted applications are left alone. Prior model decisions are audited.
export const RULE_SKIP_REASONS=['LOW_MATCH_SCORE','NO_ANGULAR_RELEVANCE','LOCATION_MISMATCH','EXPERIENCE_TOO_HIGH','EXPERIENCE_TOO_LOW','REACT_PRIMARY','JAVA_PRIMARY','DOTNET_PRIMARY','PHP_PRIMARY','INTERNSHIP','FRESHER','INSUFFICIENT_INFORMATION'];
export async function rescoreRuleSkippedJobs(runId?: string) {
 const jobs=await database.select().from(discoveredJobs).where(and(
 isNull(discoveredJobs.overriddenAt),
 inArray(discoveredJobs.applicationStatus,['New','Skipped','Waiting for approval']),
 notExists(database.select({id:submittedApplications.id}).from(submittedApplications).where(eq(submittedApplications.jobId,discoveredJobs.id)))));
 const eligible=jobs.filter(j=>j.applicationStatus==='New'||j.applicationStatus==='Waiting for approval'||(j.skipReason&&RULE_SKIP_REASONS.includes(j.skipReason)));
 const changed: Array<{id: string; before: string | null}>=[];
 for(const candidate of eligible) {
 await database.transaction(async tx=>{
 const [j]=await tx.select().from(discoveredJobs).where(eq(discoveredJobs.id,candidate.id)).for('update');
 const reserved=await tx.select({id:submittedApplications.id}).from(submittedApplications).where(eq(submittedApplications.jobId,candidate.id));
 if(!j||reserved.length||j.overriddenAt||!['New','Skipped','Waiting for approval'].includes(j.applicationStatus)||(j.applicationStatus==='Skipped'&&(!j.skipReason||!RULE_SKIP_REASONS.includes(j.skipReason)))) return;
 const n=normalizeListing({sourceName:j.sourceName,sourceSlug:j.sourceSlug??'',sourceJobId:j.sourceJobId??j.id,companyName:j.companyName,roleTitle:j.roleTitle,
 locationText:j.locationText??'',jobDescription:j.jobDescription,applyUrl:j.applyUrl,sourceUrl:j.sourceUrl??j.applyUrl,salaryText:j.salaryText??undefined});
 const email=extractApplicationEmail(n.jobDescription);
 await audit('SCORING_RULES_UPDATED','Re-evaluating with CV and Angular visibility preferences',j.id,{previousStatus:j.applicationStatus,previousScore:j.finalScore,previousSemanticScore:j.semanticScore,previousReason:j.matchReasoning,previousPrompt:j.scoringPromptVersion},runId);
 await tx.update(discoveredJobs).set({normalizedLocation:n.normalizedLocation,workMode:n.workMode,experienceRequiredText:experienceText(experienceRange(n.jobDescription)),applyEmailAddress:email,applyMethod:applyMethodFor(email),
 applicationStatus:'New',skipReason:null,deterministicScore:null,semanticScore:null,finalScore:null,matchScore:null,confidence:null,matchReasoning:null,tailoredEmailBody:null,tailoredEmailSubject:null,updatedAt:new Date()}).where(eq(discoveredJobs.id,j.id));
 changed.push({id:j.id,before:j.skipReason});
 });
 }
 const result=await runScoringStage(runId,changed.map(c=>c.id));
 const after=changed.length?await database.select({id:discoveredJobs.id,status:discoveredJobs.applicationStatus}).from(discoveredJobs).where(inArray(discoveredJobs.id,changed.map(c=>c.id))):[];
 const promoted=after.filter(a=>a.status!=='Skipped').length;
 await audit('RESCORED',`${changed.length} rule-skipped or unscored jobs re-evaluated; ${promoted} now eligible`,undefined,{evaluated:changed.length,promoted,...result},runId);
 return {evaluated:changed.length,promoted,...result};
}
