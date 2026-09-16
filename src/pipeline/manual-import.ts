import { jobBoard, parseBoardImport } from '../sources/job-board-import.js';
import { hash, normalizeListing, normalizeUrl } from './normalization.js';
import { findExistingListing, storeNewListing } from './discovery.js';
import { runScoringStage } from './scoring.js';
import { runTailoringStage } from './tailoring.js';
import { MANUAL_SOURCE } from '../sources/registry.js';
import type { RawJobListing } from '../sources/job-source.js';
export interface ManualJobInput { applyUrl: string; companyName: string; roleTitle: string; locationText: string; jobDescription: string }
// For listings the user reads themselves on sites that do not permit automated collection (LinkedIn, Naukri, Indeed).
export function validateManualJob(body: Record<string, unknown>): ManualJobInput {
 const field=(name: string, min: number, max: number)=>{
 const v=typeof body[name]==='string'?(body[name] as string).trim():'';
 if(v.length<min||v.length>max) throw new Error(`${name} must be ${min}–${max} characters`);
 return v;
 };
 const applyUrl=field('applyUrl',10,2000);
 try { normalizeUrl(applyUrl); } catch { throw new Error('Job link must be a valid https URL'); }
 return {applyUrl,companyName:field('companyName',1,200),roleTitle:field('roleTitle',2,200),locationText:field('locationText',0,200),jobDescription:field('jobDescription',100,50000)};
}
export function manualListing(input: ManualJobInput): RawJobListing {
 const url=normalizeUrl(input.applyUrl);
 return {sourceName:jobBoard(url)??MANUAL_SOURCE,sourceSlug:new URL(url).hostname.replace(/^www\./,'').replace(/[^a-z0-9]+/gi,'-').toLowerCase(),sourceJobId:hash(url).slice(0,16),
 companyName:input.companyName,roleTitle:input.roleTitle,locationText:input.locationText,jobDescription:input.jobDescription,applyUrl:url,sourceUrl:url};
}
export async function importManualJob(input: ManualJobInput): Promise<{jobId: string; created: boolean}> {
 const j=normalizeListing(manualListing(input));
 const existing=await findExistingListing(j);
 if(existing) return {jobId:existing.id,created:false};
 await storeNewListing(j,undefined,'MANUAL_IMPORT');
 await runScoringStage(undefined,[j.id]);
 await runTailoringStage();
 return {jobId:j.id,created:true};
}

export async function importBoardJobs(value:unknown) {
 const rows=parseBoardImport(value); // Validate the entire batch before writing.
 const results:Array<{jobId:string;created:boolean}>=[];
 for(const row of rows){
 const j=normalizeListing(row),existing=await findExistingListing(j);
 if(existing){results.push({jobId:existing.id,created:false});continue;}
 await storeNewListing(j,undefined,'MANUAL_IMPORT');results.push({jobId:j.id,created:true});
 }
 const ids=results.filter(r=>r.created).map(r=>r.jobId);
 if(ids.length) await runScoringStage(undefined,ids);
 return {results,created:ids.length,duplicates:results.length-ids.length};
}
