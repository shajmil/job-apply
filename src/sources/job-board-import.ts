import { readFile } from 'node:fs/promises';
import type { JobSource, RawJobListing } from './job-source.js';
import { hash, normalizeUrl } from '../pipeline/normalization.js';
export function jobBoard(url:string):'linkedin'|'naukri'|null {
 const host=new URL(url).hostname.toLowerCase();
 return host==='linkedin.com'||host.endsWith('.linkedin.com')?'linkedin':host==='naukri.com'||host.endsWith('.naukri.com')?'naukri':null;
}
export function parseBoardImport(value:unknown): RawJobListing[] {
 if(!Array.isArray(value)||!value.length||value.length>100)throw new Error('Supply a JSON array of 1–100 jobs');
 return value.map((v:unknown)=>{
 if(!v||typeof v!=='object')throw new Error('Each job must be an object');
 const row=v as Record<string,unknown>;
 const field=(key:string,min:number,max:number)=>{const s=typeof row[key]==='string'?row[key].trim():'';if(s.length<min||s.length>max)throw new Error(`${key} must be ${min}–${max} characters`);return s;};
 const applyUrl=normalizeUrl(field('applyUrl',10,2000)),sourceName=jobBoard(applyUrl);
 if(!sourceName)throw new Error('Bulk import accepts only LinkedIn or Naukri job links');
 return {sourceName,sourceSlug:'user-import',sourceJobId:hash(applyUrl).slice(0,16),applyUrl,sourceUrl:applyUrl,
 companyName:field('companyName',1,200),roleTitle:field('roleTitle',2,200),locationText:field('locationText',0,200),jobDescription:field('jobDescription',100,50000)};
 });
}
// User-exported data, not an unauthorised crawler or a source of automatic closure signals.
export function importedBoardSources():JobSource[] {
 return (process.env.JOB_BOARD_IMPORT_FILES??'').split(',').map(s=>s.trim()).filter(Boolean).map(path=>({
 sourceName:'job-board-import',sourceSlug:path,
 async fetchListings(){return parseBoardImport(JSON.parse(await readFile(path,'utf8')));},
 async fetchBatch(){const listings=await this.fetchListings();return {listings,seenIds:new Set(listings.map(j=>j.sourceJobId)),complete:false};}
 }));
}
