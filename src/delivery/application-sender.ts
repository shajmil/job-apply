import nodemailer from 'nodemailer';
import { randomUUID } from 'node:crypto';
import { and, eq, gte, sql } from 'drizzle-orm';
import { database } from '../db/client.js';
import { discoveredJobs, submittedApplications } from '../db/schema.js';
import { env } from '../config/env.js';
import { guardJob, approvalVersion } from '../safety/application-guards.js';
import { verifyJob } from '../pipeline/verification.js';
import { resume } from './preview.js';
import { audit, auditError } from '../logging/logger.js';
export async function submitApprovedApplication(jobId:string, version:string):Promise<void> {
 try { await sendApproved(jobId,version); }
 catch(e) { if(!(e instanceof DeliveryAttemptError)) await auditError('APPLICATION_BLOCKED',e,jobId,{version}); throw e instanceof DeliveryAttemptError?e.cause:e; }
}
// Wraps failures after a reservation exists; those are already audited as APPLICATION_ERROR.
class DeliveryAttemptError extends Error { constructor(override readonly cause: unknown) { super(String(cause)); } }
async function sendApproved(jobId:string, version:string):Promise<void> {
 if(!env.sendingEnabled()) throw new Error('Application sending is disabled');
 const approvedAt=new Date();
 // Global transaction lock serializes reservations and the daily cap across processes.
 const reservation=await database.transaction(async tx=>{
 await tx.execute(sql`select pg_advisory_xact_lock(731925)`);
 const [j]=await tx.select().from(discoveredJobs).where(eq(discoveredJobs.id,jobId)).for('update');
 if(!j) throw new Error('Job not found'); guardJob(j,jobId);
 const r=await resume(); if(!version||version!==approvalVersion(j,r.hash)) throw new Error('Preview changed; review the latest draft and resume');
 const prior=await tx.select().from(submittedApplications).where(eq(submittedApplications.jobId,jobId));
 if(prior.length) throw new Error('Application already reserved or submitted; inspect delivery record');
 // IST calendar day, including pending/uncertain deliveries to fail closed.
 const now=Date.now(),offset=330*60000;
 const day=new Date(new Date(now+offset).toISOString().slice(0,10)+'T00:00:00+05:30');
 const sent=await tx.select().from(submittedApplications).where(gte(submittedApplications.submittedAt,day));
 if(sent.length>=env.dailyLimit()) throw new Error('Daily application limit reached');
 await verifyJob(j);
 if(!env.sendingEnabled()) throw new Error('Application sending is disabled');
 const id=randomUUID();
 await tx.insert(submittedApplications).values({id,jobId,deliveryChannel:'email',recipientAddress:j.applyEmailAddress,approvedByUserAt:approvedAt,outcomeStatus:'Sending'});
 await tx.update(discoveredJobs).set({lastVerifiedAt:new Date()}).where(eq(discoveredJobs.id,jobId));
 return {id,j,r};
 });
 await audit('APPROVED','Explicit approval recorded',jobId,{version,approvedAt});
 try {
 if(!env.sendingEnabled()) throw new Error('Application sending is disabled');
 const from=process.env.APPLICANT_EMAIL_ADDRESS, user=process.env.NOTIFY_GMAIL_ADDRESS,pass=process.env.NOTIFY_GMAIL_APP_PASSWORD;
 if(!from||!user||!pass) throw new Error('Email credentials or sender are missing');
 const transport=nodemailer.createTransport({service:'gmail',auth:{user,pass},connectionTimeout:20000,socketTimeout:30000});
 const result=await transport.sendMail({from,to:reservation.j.applyEmailAddress!,subject:reservation.j.tailoredEmailSubject!,text:reservation.j.tailoredEmailBody!,attachments:[{filename:reservation.r.filename,content:reservation.r.data}]});
 await database.transaction(async tx=>{
 await tx.update(submittedApplications).set({providerMessageId:result.messageId,outcomeStatus:'Applied',submittedAt:new Date()}).where(eq(submittedApplications.id,reservation.id));
 await tx.update(discoveredJobs).set({applicationStatus:'Applied',updatedAt:new Date()}).where(eq(discoveredJobs.id,jobId));
 });
 await audit('APPLICATION_SENT','Provider accepted application',jobId,{messageId:result.messageId});
 } catch(e) {
 await database.update(submittedApplications).set({outcomeStatus:'Delivery uncertain',notes:'Do not retry automatically. Inspect provider before manual reconciliation.'}).where(eq(submittedApplications.id,reservation.id));
 await auditError('APPLICATION_ERROR',e,jobId);throw new DeliveryAttemptError(e);
 }
}
