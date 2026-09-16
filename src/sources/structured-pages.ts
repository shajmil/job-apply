import { gunzipSync } from 'node:zlib';
import type { JobSource, RawJobListing, SourceBatch } from './job-source.js';
import { awaitPoliteSlot, politeFetch, politeText } from './http.js';
import { hostDomain, htmlToText, httpsUrl, isJobPlatformDomain, jsonLdJobPostings, listingFromJobPosting, slugify } from './html.js';
import { newAgentContext, withBrowser } from './browser.js';
import { mapLimit } from '../utils/concurrency.js';
import { positiveInt } from '../config/env.js';
export interface SitemapEntry { loc: string; lastmod: number | null }
const keywordList=(value: string | undefined, fallback: string)=>(value??fallback).split(',').map(k=>k.trim().toLowerCase()).filter(Boolean);
const maxPerRun=()=>positiveInt('STRUCTURED_SOURCE_MAX_JOBS',30);
export function parseSitemap(xml: string): {entries: SitemapEntry[]; children: string[]} {
 const entries: SitemapEntry[]=[], children: string[]=[];
 const isIndex=/<sitemapindex/i.test(xml);
 for(const block of xml.matchAll(/<(url|sitemap)>([\s\S]*?)<\/\1>/gi)) {
 const loc=block[2].match(/<loc>\s*([^<\s]+)\s*<\/loc>/i)?.[1];
 if(!loc) continue;
 if(isIndex) { children.push(loc); continue; }
 const lastmod=Date.parse(block[2].match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i)?.[1]??'');
 entries.push({loc,lastmod:Number.isFinite(lastmod)?lastmod:null});
 }
 return {entries,children};
}
async function readSitemap(url: string): Promise<string> {
 const bytes=Buffer.from(await (await politeFetch(url,{accept:'application/xml,text/xml,*/*'})).arrayBuffer());
 return (bytes[0]===0x1f&&bytes[1]===0x8b?gunzipSync(bytes):bytes).toString('utf8');
}
// Keyword match against the URL slug, newest first when the sitemap provides lastmod.
export function selectEntries(entries: SitemapEntry[], keywords: string[], limit: number): SitemapEntry[] {
 const matching=entries.filter(e=>{ const slug=decodeURIComponent(new URL(e.loc).pathname).toLowerCase(); return keywords.some(k=>slug.includes(k)); });
 return matching.sort((a,b)=>(b.lastmod??0)-(a.lastmod??0)).slice(0,limit);
}
const partial=(results: Array<RawJobListing | null>): SourceBatch=>{ const listings=results.filter((l): l is RawJobListing=>!!l); return {listings,seenIds:new Set(listings.map(l=>l.sourceJobId)),complete:false,failedDetails:results.length-listings.length}; };

// ---- Cutshort: allowed /job/ pages listed in the jobs sitemap, each carrying a schema.org JobPosting.
export function createCutshortSource(keywords=keywordList(process.env.CUTSHORT_KEYWORDS,'angular')): JobSource {
 const sourceName='cutshort', sourceSlug='india';
 const read=async(url: string)=>{ const posting=jsonLdJobPostings(await politeText(url))[0]; return posting?listingFromJobPosting(posting,{sourceName,sourceSlug,pageUrl:url}):null; };
 async function fetchBatch(): Promise<SourceBatch> {
 const {entries}=parseSitemap(await readSitemap('https://cutshort.io/sitemap_jobs.xml'));
 const selected=selectEntries(entries.filter(e=>new URL(e.loc).pathname.startsWith('/job/')),keywords,maxPerRun());
 return partial(await mapLimit(selected,1,e=>read(e.loc).catch(()=>null)));
 }
 return {sourceName,sourceSlug,fetchBatch,fetchListings:async()=>(await fetchBatch()).listings,
 async fetchListing({sourceUrl}) { if(!sourceUrl) return null; try { return await read(sourceUrl); } catch(e) { if((e as {status?:number}).status===404) return null; throw e; } }};
}

// ---- Hirist: job pages load their details through page scripts, so each page is rendered and the job data it loads is read.
interface HiristDetail { id: number; title?: string; introText?: string; min?: number; max?: number; status?: number; workFromHome?: number; jobDetailUrl?: string;
 locations?: Array<{name?: string}>; tags?: Array<{name?: string}>; companyData?: {companyName?: string}; createdTime?: number }
export function listingFromHirist(d: HiristDetail, pageUrl: string): RawJobListing | null {
 if(d.status!==undefined&&d.status!==1) return null;
 const title=(d.title??'').trim(), body=htmlToText(d.introText??''), url=httpsUrl(d.jobDetailUrl??pageUrl)??pageUrl;
 if(!d.id||!title||!body) return null;
 const places=(d.locations??[]).map(l=>l.name).filter(Boolean).join(', ');
 const skills=(d.tags??[]).map(t=>t.name).filter(Boolean).join(', ');
 const experience=Number.isFinite(d.min)&&Number.isFinite(d.max)?`Experience: ${d.min}-${d.max} years`:'';
 return {sourceName:'hirist',sourceSlug:'india',sourceJobId:String(d.id),companyName:(d.companyData?.companyName??'').trim()||'Hirist employer',roleTitle:title,
 locationText:[d.workFromHome?'Remote':'',places].filter(Boolean).join(', '),jobDescription:[experience,body,skills&&`Skills: ${skills}`].filter(Boolean).join('\n\n'),
 applyUrl:url,sourceUrl:pageUrl,postedAtText:d.createdTime?new Date(d.createdTime).toISOString().slice(0,10):undefined};
}
async function renderHirist(urls: string[]): Promise<Array<RawJobListing | null>> {
 return withBrowser(async browser=>{
 const context=await newAgentContext(browser);
 const results: Array<RawJobListing | null>=[];
 for(const url of urls) {
 try {
 await awaitPoliteSlot(url,10000);
 const page=await context.newPage();
 try {
 const detail=page.waitForResponse(r=>r.url().includes('/job/detail?jobcode=')&&r.status()===200,{timeout:45000});
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
 const payload=await (await detail).json() as {data?: HiristDetail};
 results.push(payload.data?listingFromHirist(payload.data,url):null);
 } finally { await page.close(); }
 } catch { results.push(null); }
 }
 return results;
 });
}
export function createHiristSource(keywords=keywordList(process.env.HIRIST_KEYWORDS,'angular')): JobSource {
 const sourceName='hirist', sourceSlug='india';
 async function fetchBatch(): Promise<SourceBatch> {
 const index=parseSitemap(await readSitemap('https://www.hirist.tech/new_sitemap_index.xml'));
 const entries: SitemapEntry[]=[];
 for(const child of index.children.filter(c=>/sitemap-j-\d+/.test(c))) entries.push(...parseSitemap(await readSitemap(child)).entries);
 // Hirist asks for a 10 second crawl delay, so fewer pages are rendered per run.
 const selected=selectEntries(entries.filter(e=>new URL(e.loc).pathname.startsWith('/j/')),keywords,Math.min(maxPerRun(),positiveInt('HIRIST_MAX_JOBS',15)));
 return partial(await renderHirist(selected.map(e=>e.loc)));
 }
 return {sourceName,sourceSlug,fetchBatch,fetchListings:async()=>(await fetchBatch()).listings,
 async fetchListing({sourceUrl}) { return sourceUrl?(await renderHirist([sourceUrl]))[0]:null; }};
}

// ---- Company career pages: JobPosting data on the page itself or on job pages it links to.
// Set CAREER_PAGES_RENDER=true for career sites that build their listings with page scripts.
const renderPages=()=>process.env.CAREER_PAGES_RENDER==='true';
async function pageHtml(urls: string[]): Promise<Array<string | null>> {
 if(!renderPages()) return mapLimit(urls,1,u=>politeText(u).catch(()=>null));
 return withBrowser(async browser=>{
 const context=await newAgentContext(browser), out: Array<string | null>=[];
 for(const url of urls) {
 try { await awaitPoliteSlot(url); const page=await context.newPage(); try { await page.goto(url,{waitUntil:'networkidle',timeout:45000}); out.push(await page.content()); } finally { await page.close(); } }
 catch { out.push(null); }
 }
 return out;
 });
}
export function jobLinks(html: string, pageUrl: string, limit: number): string[] {
 const base=new URL(pageUrl), links=new Set<string>();
 for(const m of html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)) {
 const url=httpsUrl(m[1],pageUrl); if(!url) continue;
 const u=new URL(url);
 if(u.host!==base.host||u.pathname===base.pathname) continue;
 if(/\/(jobs?|careers?|openings?|positions?|vacanc(y|ies)|opportunit(y|ies))\/[^/]+/i.test(u.pathname)) links.add(u.origin+u.pathname);
 if(links.size>=limit) break;
 }
 return [...links];
}
export function createCareerPageSource(host: string, pages: string[]): JobSource {
 const sourceName='career', sourceSlug=slugify(host);
 const fromHtml=(html: string, url: string)=>jsonLdJobPostings(html).map(p=>listingFromJobPosting(p,{sourceName,sourceSlug,pageUrl:url})).filter((l): l is RawJobListing=>!!l);
 async function fetchBatch(): Promise<SourceBatch> {
 const listings: RawJobListing[]=[];
 const pageHtmls=await pageHtml(pages);
 for(const [i,html] of pageHtmls.entries()) {
 if(!html) throw Object.assign(new Error(`Could not read career page ${pages[i]}`),{status:503});
 const direct=fromHtml(html,pages[i]);
 if(direct.length) { listings.push(...direct); continue; }
 const links=jobLinks(html,pages[i],positiveInt('CAREER_PAGE_MAX_LINKS',30));
 for(const [j,linked] of (await pageHtml(links)).entries()) if(linked) listings.push(...fromHtml(linked,links[j]));
 }
 // The career site's own domain identifies the employer unless it is a shared hiring platform.
 const siteDomain=hostDomain(host), ownSite=siteDomain&&!isJobPlatformDomain(siteDomain)?siteDomain:undefined;
 const unique=[...new Map(listings.map(l=>[l.sourceJobId,{...l,companyDomain:l.companyDomain??ownSite}])).values()];
 return {...partial(unique),failedDetails:0};
 }
 return {sourceName,sourceSlug,fetchBatch,fetchListings:async()=>(await fetchBatch()).listings,
 async fetchListing({sourceJobId,sourceUrl}) {
 if(!sourceUrl) return null;
 const [html]=await pageHtml([sourceUrl]);
 if(!html) return null;
 const found=fromHtml(html,sourceUrl);
 return found.find(l=>l.sourceJobId===sourceJobId)??null;
 }};
}
export function careerPageSources(value=process.env.CAREER_PAGES??''): JobSource[] {
 const byHost=new Map<string,string[]>();
 for(const raw of value.split(',').map(s=>s.trim()).filter(Boolean)) {
 const url=httpsUrl(raw); if(!url) throw new Error(`CAREER_PAGES entries must be https URLs: ${raw}`);
 const host=new URL(url).host; byHost.set(host,[...(byHost.get(host)??[]),url]);
 }
 return [...byHost].map(([host,pages])=>createCareerPageSource(host,pages));
}
