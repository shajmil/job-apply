import 'dotenv/config';
import cron from 'node-cron';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { database,pool } from './db/client.js';
import { discoveredJobs,agentRuns,submittedApplications } from './db/schema.js';
import { runDiscoveryStage } from './pipeline/discovery.js';
import { runScoringStage } from './pipeline/scoring.js';
import { runTailoringStage } from './pipeline/tailoring.js';
import { rescoreRuleSkippedJobs } from './pipeline/rescore.js';
import { runDigestReportingStage } from './delivery/digest-reporter.js';
import { submitApprovedApplication } from './delivery/application-sender.js';
import { preview } from './delivery/preview.js';
import { startDashboard } from './dashboard/server.js';
import { audit, auditError } from './logging/logger.js';
async function run() {
 const client=await pool.connect();const id=randomUUID(),start=Date.now();let locked=false;
 try {
 const result=await client.query('select pg_try_advisory_lock(731926) as locked');locked=result.rows[0].locked;
 if(!locked){console.log('Another discovery run holds the lock; skipping this run');return;}
 await database.insert(agentRuns).values({id});
 try {
 const d=await runDiscoveryStage(id);const s=await runScoringStage(id);const t=await runTailoringStage(id);
 let digestErrors=0;
 try {await runDigestReportingStage();} catch(e) {digestErrors=1;await auditError('DIGEST_ERROR',e,undefined,{},id);}
 const errors=d.errors+s.errors+t.errors+digestErrors;
 // Counts describe this run only; hard-filtered new listings are skipped during discovery.
 await database.update(agentRuns).set({completedAt:new Date(),durationMs:Date.now()-start,status:errors?'Partial':'Completed',jobsDiscovered:d.discovered,jobsNew:d.inserted,jobsScored:s.scored,jobsQualified:s.qualified,jobsSkipped:s.skipped+d.hardFiltered,errors}).where(eq(agentRuns.id,id));
 await audit('RUN_COMPLETED',`${d.discovered} listings, ${d.inserted} new, ${d.duplicates} duplicates, ${s.qualified} qualified, ${t.drafted} drafted`,undefined,{errors,duplicates:d.duplicates},id);
 } catch(e) {
 await auditError('RUN_ERROR',e,undefined,{},id);
 await database.update(agentRuns).set({status:'Failed',errors:1,completedAt:new Date(),durationMs:Date.now()-start}).where(eq(agentRuns.id,id));
 throw e;
 }
 }
 finally {if(locked)await client.query('select pg_advisory_unlock(731926)');client.release();}
}
async function main() {
 const args=process.argv.slice(2);
 if(args.includes('--dashboard')) {startDashboard();return;}
 if(args.includes('--once')) {try{await run();}finally{await pool.end();}return;}
 if(args.includes('--rescore')) {try{const r=await rescoreRuleSkippedJobs();await runTailoringStage();console.log(JSON.stringify(r));}finally{await pool.end();}return;}
 if(args.includes('--pending')) {try {const jobs=await database.select().from(discoveredJobs).where(eq(discoveredJobs.applicationStatus,'Waiting for approval'));for(const j of jobs) console.log(JSON.stringify(await preview(j),null,2));}finally{await pool.end();}return;}
 if(args.includes('--apply')) {try {const id=args[args.indexOf('--apply')+1],v=args.indexOf('--version');if(!id||v<0||!args[v+1])throw new Error('Use --pending to review, then --apply JOB_ID --version APPROVAL_VERSION');await submitApprovedApplication(id,args[v+1]);}finally{await pool.end();}return;}
 if(args.includes('--skip')) {try {const id=args[args.indexOf('--skip')+1];if(!id)throw new Error('Job ID required');await database.transaction(async tx=>{const [j]=await tx.select().from(discoveredJobs).where(eq(discoveredJobs.id,id)).for('update');const prior=await tx.select().from(submittedApplications).where(eq(submittedApplications.jobId,id));if(prior.length||!j||!['New','Waiting for approval','Skipped'].includes(j.applicationStatus))throw new Error('Job cannot be skipped');await tx.update(discoveredJobs).set({applicationStatus:'Skipped',skipReason:'OTHER',updatedAt:new Date()}).where(eq(discoveredJobs.id,id));});await audit('USER_SKIP','CLI skip',id);}finally{await pool.end();}return;}
 if(args.length)throw new Error('Unknown command');
 const schedule=process.env.CRON_SCHEDULE??'0 9 * * *';if(!cron.validate(schedule))throw new Error('Invalid CRON_SCHEDULE');
 cron.schedule(schedule,()=>{void run().catch(e=>console.error(String(e)));},{timezone:'Asia/Kolkata'});
 if(process.env.RUN_ON_STARTUP==='true')await run();
 console.log('Scheduled discovery in Asia/Kolkata:',schedule);
}
main().catch(e=>{console.error(String(e));process.exitCode=1;});
