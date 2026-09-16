import { rescoreRuleSkippedJobs } from '../pipeline/rescore.js';
import { metrics } from './metrics.js';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, relative, isAbsolute } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { eq, desc } from 'drizzle-orm';
import { database } from '../db/client.js';
import { discoveredJobs, submittedApplications } from '../db/schema.js';
import { preview, resume } from '../delivery/preview.js';
import { submitApprovedApplication } from '../delivery/application-sender.js';
import { audit } from '../logging/logger.js';
import { classifyQuestion } from '../pipeline/screening.js';
import { runTailoringStage } from '../pipeline/tailoring.js';
import { QUALIFY_THRESHOLD, shouldShowForReview, reviewPolicy } from '../pipeline/deterministic-scoring.js';
import { positiveInt } from '../config/env.js';
import { importManualJob, validateManualJob, importBoardJobs } from '../pipeline/manual-import.js';
// Resolves a request path inside the bundle directory; anything escaping it (or unknown) falls back to index.html.
export function resolveStaticPath(root: string, pathname: string): string {
 let decoded: string; try { decoded=decodeURIComponent(pathname); } catch { return resolve(root,'index.html'); }
 const path=resolve(root,'.'+decoded), rel=relative(root,path);
 return rel && !rel.startsWith('..') && !isAbsolute(rel) ? path : resolve(root,'index.html');
}
// The list view needs summary fields only; full descriptions and drafts are loaded per job.
const listColumns={id:discoveredJobs.id,companyName:discoveredJobs.companyName,roleTitle:discoveredJobs.roleTitle,locationText:discoveredJobs.locationText,normalizedLocation:discoveredJobs.normalizedLocation,workMode:discoveredJobs.workMode,salaryText:discoveredJobs.salaryText,sourceName:discoveredJobs.sourceName,applicationStatus:discoveredJobs.applicationStatus,finalScore:discoveredJobs.finalScore,deterministicScore:discoveredJobs.deterministicScore,overrideScore:discoveredJobs.overrideScore,confidence:discoveredJobs.confidence,discoveredAt:discoveredJobs.discoveredAt,jobActive:discoveredJobs.jobActive,skipReason:discoveredJobs.skipReason,applyMethod:discoveredJobs.applyMethod,riskFlags:discoveredJobs.riskFlags,llmCost:discoveredJobs.llmCost};
const contentTypes: Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
export function startDashboard() {
 const token=process.env.DASHBOARD_TOKEN; if(!token||token.length<24) throw new Error('Set DASHBOARD_TOKEN to at least 24 characters');
 const server=createServer(async(req,res)=>{
 const url=new URL(req.url??'/','http://localhost');
 const json=(status:number,data:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 try {
 if(url.pathname.startsWith('/api/')) {
 const provided=Buffer.from((req.headers.authorization??'').replace(/^Bearer /,'')),expected=Buffer.from(token);
 if(provided.length!==expected.length||!timingSafeEqual(provided,expected)) return json(401,{error:'Authentication required'});
 if(req.method==='GET'&&url.pathname==='/api/jobs') { const rows=await database.select({...listColumns,jobDescription:discoveredJobs.jobDescription}).from(discoveredJobs).orderBy(desc(discoveredJobs.discoveredAt));return json(200,rows.map(j=>({...j,recommended:['New','Waiting for approval'].includes(j.applicationStatus)&&reviewPolicy(j).visible}))); }
 if(req.method==='GET'&&url.pathname==='/api/metrics') return json(200,await metrics());
 if(req.method==='GET'&&url.pathname==='/api/resume') {const r=await resume();res.writeHead(200,{'Content-Type':'application/pdf','Cache-Control':'no-store'});res.end(r.data);return;}
 const readBody=async()=>{let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>6000000) throw new Error('Request too large');}return JSON.parse(raw||'{}') as Record<string,unknown>;};
 if(req.method==='POST'&&url.pathname==='/api/import-board-jobs') return json(200,await importBoardJobs((await readBody()).jobs));
 if(req.method==='POST'&&url.pathname==='/api/rescore') return json(200,await rescoreRuleSkippedJobs());
 if(req.method==='POST'&&url.pathname==='/api/import-job') return json(200,await importManualJob(validateManualJob(await readBody())));
 const m=url.pathname.match(/^\/api\/jobs\/([^/]+)(?:\/(preview|edit|skip|override|approve|screening|outcome))?$/);
 if(!m) return json(404,{error:'Not found'});
 const [j]=await database.select().from(discoveredJobs).where(eq(discoveredJobs.id,m[1]));if(!j) return json(404,{error:'Job not found'});
 if(req.method==='GET') return json(200,await preview(j));
 if(req.method!=='POST') return json(405,{error:'Method not allowed'});
 const b=await readBody();
 if(m[2]==='approve') {
 if(b.approved!==true||typeof b.version!=='string') throw new Error('Explicit approval of current preview required');
 await submitApprovedApplication(j.id,b.version);return json(200,{ok:true});
 }
 const reason=typeof b.reason==='string'?b.reason.trim().slice(0,500):'';
 await database.transaction(async tx=>{
 const [current]=await tx.select().from(discoveredJobs).where(eq(discoveredJobs.id,j.id)).for('update');
 const reservations=await tx.select().from(submittedApplications).where(eq(submittedApplications.jobId,j.id));
 if(reservations.length&&m[2]!=='outcome') throw new Error('Application is already reserved or sent');
 if(!['New','Waiting for approval','Skipped'].includes(current.applicationStatus)&&m[2]!=='outcome') throw new Error('Job is no longer editable');
 if(m[2]==='edit') {
 if(typeof b.subject!=='string'||typeof b.body!=='string'||!b.subject.trim()||!b.body.trim()||/[\r\n]/.test(b.subject)) throw new Error('Valid subject and message required');
 await tx.update(discoveredJobs).set({tailoredEmailSubject:b.subject,tailoredEmailBody:b.body,updatedAt:new Date()}).where(eq(discoveredJobs.id,j.id));
 } else if(m[2]==='skip') await tx.update(discoveredJobs).set({applicationStatus:'Skipped',skipReason:'OTHER',updatedAt:new Date()}).where(eq(discoveredJobs.id,j.id));
 else if(m[2]==='override') {
 if(!Number.isInteger(b.score)||Number(b.score)<0||Number(b.score)>100||!reason) throw new Error('Score 0–100 and reason required');
 const passes=shouldShowForReview(current)||Number(b.score)>=QUALIFY_THRESHOLD;
 // The original model decision is preserved in originalScore and the audit trail.
 await tx.update(discoveredJobs).set({originalScore:current.originalScore??current.finalScore,overrideScore:Number(b.score),overrideReason:reason,overriddenBy:'dashboard-user',overriddenAt:new Date(),applicationStatus:passes?'Waiting for approval':'Skipped',skipReason:passes?null:'LOW_MATCH_SCORE',updatedAt:new Date()}).where(eq(discoveredJobs.id,j.id));
 } else if(m[2]==='screening') {
 if(typeof b.question!=='string'||!b.question.trim()||b.question.length>1000) throw new Error('Question required');
 const answer=classifyQuestion(b.question);
 if(answer.classification==='ASK_USER'&&typeof b.answer==='string'&&b.answer.trim()) answer.answer=b.answer.trim();
 await tx.update(discoveredJobs).set({screeningData:[...(current.screeningData??[]).filter(q=>q.question!==b.question),answer],updatedAt:new Date()}).where(eq(discoveredJobs.id,j.id));
 } else if(m[2]==='outcome') {
 if(!['Rejected','Interview','Offer'].includes(String(b.status))||!reservations.some(a=>['Applied','Rejected','Interview','Offer'].includes(a.outcomeStatus))) throw new Error('Valid submitted application and outcome required');
 await tx.update(discoveredJobs).set({applicationStatus:String(b.status),updatedAt:new Date()}).where(eq(discoveredJobs.id,j.id));
 await tx.update(submittedApplications).set({outcomeStatus:String(b.status),responseReceivedAt:new Date(),notes:typeof b.notes==='string'?b.notes:null}).where(eq(submittedApplications.jobId,j.id));
 } else throw new Error('Unsupported action');
 });
 await audit('USER_'+m[2]!.toUpperCase(),'Dashboard action recorded',j.id,{reason:reason||undefined,falsePositive:m[2]==='skip'?b.falsePositive===true:undefined,score:m[2]==='override'?b.score:undefined,status:m[2]==='outcome'?b.status:undefined});
 if(m[2]==='override'&&(shouldShowForReview(j)||Number(b.score)>=QUALIFY_THRESHOLD)) await runTailoringStage();
 return json(200,{ok:true});
 }
 if(req.method!=='GET') return json(405,{error:'Method not allowed'});
 const root=resolve('dashboard/dist');let path=resolveStaticPath(root,url.pathname);
 let data:Buffer;try{data=await readFile(path);}catch{path=resolve(root,'index.html');data=await readFile(path);}
 res.writeHead(200,{'Content-Type':contentTypes[extname(path)]??'application/octet-stream','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer'});res.end(data);
 } catch(e){json(400,{error:e instanceof Error?e.message:'Request failed'});}
 });
 server.listen(positiveInt('PORT',3000),'0.0.0.0',()=>console.log('Review dashboard: http://localhost:'+positiveInt('PORT',3000)));
 return server;
}
