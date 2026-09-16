import type { JobSource, RawJobListing, SourceBatch } from './job-source.js';
import { isTechRole } from './relevance.js';
import { politeJson, politeText } from './http.js';
import { decodeEntities, hostDomain, htmlToText } from './html.js';
import { mapLimit } from '../utils/concurrency.js';
const startOfToday=()=>{ const d=new Date(); d.setHours(0,0,0,0); return d.getTime(); };
const MAX_PAGES=60;

// ---- Infopark (Kochi, Thrissur, Cherthala): server-rendered listing tables and detail pages.
const INFOPARK='https://infopark.in';
export const INFOPARK_CAMPUSES: Array<[slug: string, location: string]>=[
 ['infopark-kochi-phase-1','Infopark Phase 1, Kakkanad, Kochi, Kerala, India'],
 ['infopark-kochi-phase-2','Infopark Phase 2, Kakkanad, Kochi, Kerala, India'],
 ['i-by-infopark-ernakulam-south-metro-station','Ernakulam South, Kochi, Kerala, India'],
 ['infopark-thrissur','Thrissur, Kerala, India'],
 ['infopark-cherthala','Cherthala, Alappuzha, Kerala, India']
];
export interface InfoparkRow { postedAt: string; title: string; company: string; lastDate: string; companyId: string; jobId: string; url: string }
export function parseInfoparkList(html: string): {rows: InfoparkRow[]; hasNext: (page: number)=>boolean} {
 const rows: InfoparkRow[]=[];
 for(const tr of html.split(/<tr[\s>]/i).slice(1)) {
 const link=tr.match(/href="(https:\/\/infopark\.in\/company-jobs\/details\/(\d+)\/(\d+))"/);
 const cells=[...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>decodeEntities(m[1].replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim());
 if(link&&cells.length>=4) rows.push({postedAt:cells[0],title:cells[1],company:cells[2],lastDate:cells[3],companyId:link[2],jobId:link[3],url:link[1]});
 }
 return {rows,hasNext:page=>html.includes(`page=${page+1}"`)};
}
export function parseInfoparkDetail(html: string): {company: string; title: string; description: string} | null {
 const company=html.match(/<div class="con">\s*<h4>([\s\S]*?)<\/h4>/i)?.[1];
 const box=html.match(/<div class="deatil-box">\s*<h4>([\s\S]*?)<\/h4>([\s\S]*?)(?:<div class="contact">([\s\S]*?)<\/div>|<\/div>\s*<\/div>)/i);
 if(!company||!box) return null;
 const description=[htmlToText(box[2]),box[3]?htmlToText(box[3]):''].filter(Boolean).join('\n\n');
 return {company:decodeEntities(company).trim(),title:decodeEntities(box[1]).replace(/\s+/g,' ').trim(),description};
}
export function createInfoparkSource(): JobSource {
 const sourceName='infopark', sourceSlug='kerala';
 async function detail(row: Pick<InfoparkRow,'url'|'jobId'|'postedAt'>, location: string): Promise<RawJobListing | null> {
 const parsed=parseInfoparkDetail(await politeText(row.url));
 if(!parsed) return null;
 return {sourceName,sourceSlug,sourceJobId:row.jobId,companyName:parsed.company,roleTitle:parsed.title,locationText:location,jobDescription:parsed.description,applyUrl:row.url,sourceUrl:row.url,postedAtText:row.postedAt||undefined};
 }
 async function fetchBatch(): Promise<SourceBatch> {
 const seenIds=new Set<string>(), wanted: Array<[InfoparkRow,string]>=[]; let ignored=0;
 for(const [campus,location] of INFOPARK_CAMPUSES) {
 for(let page=1;page<=MAX_PAGES;page++) {
 const {rows,hasNext}=parseInfoparkList(await politeText(`${INFOPARK}/companies-job/${campus}?page=${page}`));
 for(const row of rows) {
 const closes=Date.parse(row.lastDate);
 if(Number.isFinite(closes)&&closes<startOfToday()||seenIds.has(row.jobId)) continue;
 seenIds.add(row.jobId);
 if(isTechRole(row.title)) wanted.push([row,location]); else ignored++;
 }
 if(!rows.length||!hasNext(page)) break;
 }
 }
 // A failed detail page leaves the listing in seenIds so it is not mistaken for a closed job.
 const results=await mapLimit(wanted,2,([row,location])=>detail(row,location).catch(()=>null));
 const listings=results.filter((l): l is RawJobListing=>!!l);
 return {listings,seenIds,complete:true,ignored,failedDetails:results.length-listings.length};
 }
 return {sourceName,sourceSlug,fetchBatch,fetchListings:async()=>(await fetchBatch()).listings,
 async fetchListing({sourceJobId,sourceUrl,locationText}) {
 if(!sourceUrl) return null;
 try { return await detail({url:sourceUrl,jobId:sourceJobId,postedAt:''},locationText??'Kochi, Kerala, India'); }
 catch(e) { if((e as {status?:number}).status===404) return null; throw e; }
 }};
}

// ---- Technopark (Thiruvananthapuram): public JSON listing endpoint and detail pages carrying the job as page data.
const TECHNOPARK='https://technopark.in';
interface TechnoparkRow { id: number; job_title: string; posted_date: string; closing_date: string | null; company?: {company?: string} }
export function parseTechnoparkDetail(html: string): Record<string, unknown> | null {
 const attr=html.match(/data-page="([^"]*)"/)?.[1];
 if(!attr) return null;
 try { return (JSON.parse(decodeEntities(attr)) as {props?: {jobListing?: Record<string, unknown>}}).props?.jobListing??null; } catch { return null; }
}
export function listingFromTechnopark(job: Record<string, unknown>, sourceSlug: string, today=startOfToday()): RawJobListing | null {
 const str=(v: unknown)=>typeof v==='string'?v:'';
 const closes=Date.parse(str(job.closing_date));
 if(job.deleted_at||(job.status&&job.status!=='APPROVED')||(Number.isFinite(closes)&&closes<today)) return null;
 const company=(job.company??{}) as Record<string, unknown>, id=String(job.id??'');
 const body=htmlToText(str(job.job_description)), skills=htmlToText(str(job.preferred_skills)), email=str(job.contact_email).trim();
 const description=[body,skills&&`Preferred skills:\n${skills}`,job.is_walk_in?`Walk-in: ${htmlToText(str(job.walk_in_address))} ${str(job.walk_in_start_date)}`:'',email&&`Apply by email to ${email}`].filter(Boolean).join('\n\n');
 const stated=body.match(/Location\s*:\s*([^\n]+)/i)?.[1]?.trim();
 const title=decodeEntities(str(job.job_title)).trim(), url=`${TECHNOPARK}/job-details/${id}`;
 if(!id||!title||!description) return null;
 return {sourceName:'technopark',sourceSlug,sourceJobId:id,companyName:decodeEntities(str(company.company)).trim()||'Technopark company',roleTitle:title,
 locationText:`${stated?`${stated} (`:''}Technopark, Thiruvananthapuram, Kerala, India${stated?')':''}`,jobDescription:description,applyUrl:url,sourceUrl:url,
 postedAtText:str(job.posted_date)||undefined,companyDomain:hostDomain(str(company.website))};
}
export function createTechnoparkSource(): JobSource {
 const sourceName='technopark', sourceSlug='trivandrum';
 const detail=async(id: string)=>{ const job=parseTechnoparkDetail(await politeText(`${TECHNOPARK}/job-details/${id}`)); return job?listingFromTechnopark(job,sourceSlug):null; };
 async function fetchBatch(): Promise<SourceBatch> {
 const seenIds=new Set<string>(), wanted: string[]=[]; let ignored=0, lastPage=1;
 for(let page=1;page<=Math.min(lastPage,MAX_PAGES);page++) {
 const payload=await politeJson(`${TECHNOPARK}/api/paginated-jobs?page=${page}&search=&type=`) as {data?: TechnoparkRow[]; last_page?: number};
 if(!Array.isArray(payload.data)) throw Object.assign(new Error('Malformed Technopark listing page'),{status:422});
 lastPage=Number(payload.last_page)||page;
 for(const row of payload.data) {
 const closes=Date.parse(row.closing_date??'');
 if(Number.isFinite(closes)&&closes<startOfToday()) continue;
 seenIds.add(String(row.id));
 if(isTechRole(row.job_title)) wanted.push(String(row.id)); else ignored++;
 }
 }
 const results=await mapLimit(wanted,2,id=>detail(id).catch(()=>null));
 const listings=results.filter((l): l is RawJobListing=>!!l);
 return {listings,seenIds,complete:true,ignored,failedDetails:results.length-listings.length};
 }
 return {sourceName,sourceSlug,fetchBatch,fetchListings:async()=>(await fetchBatch()).listings,
 async fetchListing({sourceJobId}) { try { return await detail(sourceJobId); } catch(e) { if((e as {status?:number}).status===404) return null; throw e; } }};
}
