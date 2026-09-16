import { count, desc, eq, inArray, sql } from 'drizzle-orm';
import { database } from '../db/client.js';
import { discoveredJobs, agentRuns, agentEvents, submittedApplications } from '../db/schema.js';
export interface SourceEvent { eventType: string; message: string; createdAt: Date; metadata: unknown }
export interface SourceHealth { source: string; slug: string; healthy: boolean; lastSuccessAt: Date|null; lastFailureAt: Date|null; lastListings: number|null; lastError: string|null; consecutiveFailures: number }
// Events must be newest first. The most recent fetch decides health; failures since the last success are counted.
export function sourceHealth(events: SourceEvent[]): SourceHealth[] {
 const bySource=new Map<string,SourceHealth>();
 for(const e of events) {
 const m=(e.metadata??{}) as {source?:string;slug?:string;listings?:number};
 if(!m.source||!m.slug) continue;
 const k=`${m.source}:${m.slug}`;
 let h=bySource.get(k);
 if(!h) { h={source:m.source,slug:m.slug,healthy:e.eventType==='SOURCE_FETCHED',lastSuccessAt:null,lastFailureAt:null,lastListings:null,lastError:null,consecutiveFailures:0}; bySource.set(k,h); }
 if(e.eventType==='SOURCE_FETCHED') { if(!h.lastSuccessAt) {h.lastSuccessAt=e.createdAt;h.lastListings=m.listings??null;} }
 else { if(!h.lastFailureAt) {h.lastFailureAt=e.createdAt;h.lastError=e.message;} if(!h.lastSuccessAt) h.consecutiveFailures++; }
 }
 return [...bySource.values()].sort((a,b)=>Number(a.healthy)-Number(b.healthy)||a.slug.localeCompare(b.slug));
}
export async function metrics() {
 const [jobs,runs,events,applications,eventTotals,sourceEvents,falsePositives]=await Promise.all([
 database.select({id:discoveredJobs.id,status:discoveredJobs.applicationStatus,skipReason:discoveredJobs.skipReason,finalScore:discoveredJobs.finalScore,confidence:discoveredJobs.confidence,llmCost:discoveredJobs.llmCost,jobActive:discoveredJobs.jobActive,discoveredAt:discoveredJobs.discoveredAt}).from(discoveredJobs),
 database.select().from(agentRuns).orderBy(desc(agentRuns.startedAt)).limit(30),
 database.select({id:agentEvents.id,eventType:agentEvents.eventType,message:agentEvents.message,jobId:agentEvents.jobId,createdAt:agentEvents.createdAt,roleTitle:discoveredJobs.roleTitle,companyName:discoveredJobs.companyName}).from(agentEvents).leftJoin(discoveredJobs,eq(agentEvents.jobId,discoveredJobs.id)).orderBy(desc(agentEvents.createdAt)).limit(100),
 database.select({id:submittedApplications.id,jobId:submittedApplications.jobId,deliveryChannel:submittedApplications.deliveryChannel,recipientAddress:submittedApplications.recipientAddress,providerMessageId:submittedApplications.providerMessageId,approvedByUserAt:submittedApplications.approvedByUserAt,submittedAt:submittedApplications.submittedAt,outcomeStatus:submittedApplications.outcomeStatus,notes:submittedApplications.notes,roleTitle:discoveredJobs.roleTitle,companyName:discoveredJobs.companyName}).from(submittedApplications).leftJoin(discoveredJobs,eq(submittedApplications.jobId,discoveredJobs.id)).orderBy(desc(submittedApplications.submittedAt)),
 database.select({eventType:agentEvents.eventType,n:count()}).from(agentEvents).groupBy(agentEvents.eventType),
 database.select({eventType:agentEvents.eventType,message:agentEvents.message,createdAt:agentEvents.createdAt,metadata:agentEvents.metadata}).from(agentEvents).where(inArray(agentEvents.eventType,['SOURCE_FETCHED','SOURCE_FAILURE'])).orderBy(desc(agentEvents.createdAt)).limit(500),
 database.select({n:count()}).from(agentEvents).where(sql`${agentEvents.eventType} = 'USER_SKIP' and (${agentEvents.metadata}->>'falsePositive')::boolean is true`)
 ]);
 const mean=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
 const total=(type:string)=>eventTotals.find(e=>e.eventType===type)?.n??0;
 const tally=(values:Array<string|null>)=>Object.entries(values.reduce<Record<string,number>>((acc,v)=>{if(v)acc[v]=(acc[v]??0)+1;return acc;},{})).map(([key,n])=>({key,n})).sort((a,b)=>b.n-a.n);
 const discoveredAt=new Map(jobs.map(j=>[j.id,j.discoveredAt]));
 return {summary:{jobs:jobs.length,qualified:jobs.filter(j=>j.status==='Waiting for approval').length,
 averageScore:mean(jobs.flatMap(j=>j.finalScore===null?[]:[j.finalScore])),averageConfidence:mean(jobs.flatMap(j=>j.confidence===null?[]:[j.confidence])),
 llmCost:jobs.reduce((s,j)=>s+j.llmCost,0),applicationsSent:applications.filter(a=>a.providerMessageId).length,
 expiredJobs:jobs.filter(j=>!j.jobActive).length,duplicates:total('DUPLICATE'),sourceFailures:total('SOURCE_FAILURE'),applicationErrors:total('APPLICATION_ERROR'),
 scoringErrors:total('SCORING_ERROR'),skippedBeforeLlm:total('SKIPPED_BEFORE_LLM'),overrides:total('USER_OVERRIDE'),falsePositiveFeedback:falsePositives[0]?.n??0,
 averageDiscoveryToApprovalMs:mean(applications.flatMap(a=>{const d=discoveredAt.get(a.jobId);return d&&a.approvedByUserAt?[a.approvedByUserAt.getTime()-d.getTime()]:[];})),
 averageApprovalToSubmissionMs:mean(applications.flatMap(a=>a.providerMessageId&&a.approvedByUserAt?[a.submittedAt.getTime()-a.approvedByUserAt.getTime()]:[]))},
 statuses:tally(jobs.map(j=>j.status)),skipReasons:tally(jobs.map(j=>j.status==='Skipped'?j.skipReason:null)),
 sources:sourceHealth(sourceEvents),runs,events,applications};
}
