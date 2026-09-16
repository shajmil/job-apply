import nodemailer from 'nodemailer';
import { and, eq } from 'drizzle-orm';
import { database } from '../db/client.js';
import { discoveredJobs } from '../db/schema.js';
export async function runDigestReportingStage() {
 if(process.env.DIGEST_ENABLED!=='true') return 0;
 const jobs=await database.select().from(discoveredJobs).where(and(eq(discoveredJobs.applicationStatus,'Waiting for approval'),eq(discoveredJobs.isReportedToUser,false)));
 if(!jobs.length) return 0;
 if(!process.env.NOTIFY_RECIPIENT_ADDRESS) throw new Error('Digest recipient missing');
 await nodemailer.createTransport({service:'gmail',auth:{user:process.env.NOTIFY_GMAIL_ADDRESS,pass:process.env.NOTIFY_GMAIL_APP_PASSWORD}}).sendMail({from:process.env.NOTIFY_GMAIL_ADDRESS,to:process.env.NOTIFY_RECIPIENT_ADDRESS,subject:`${jobs.length} jobs ready for review`,text:jobs.map(j=>`${j.roleTitle} — ${j.companyName}\nScore ${j.finalScore}; confidence ${j.confidence}\n${j.locationText} | ${j.salaryText??'Salary undisclosed'}\n${j.matchReasoning}\n${j.applyUrl}\nReview in the dashboard. No application has been sent.`).join('\n\n')});
 for(const j of jobs) await database.update(discoveredJobs).set({isReportedToUser:true}).where(eq(discoveredJobs.id,j.id));
 return jobs.length;
}
