import type { JobSource, RawJobListing } from './job-source.js';
import { fetchJson } from '../utils/retry.js';
function strip(s: string): string { return s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim(); }
function obj(v: unknown): Record<string, unknown> { if(!v || typeof v !== 'object') throw Object.assign(new Error('Malformed ATS record'),{status:422}); return v as Record<string, unknown>; }
function str(v: unknown): string { return typeof v === 'string' ? v : ''; }
export function createSource(sourceName: string, sourceSlug: string): JobSource {
 if(!['lever','greenhouse'].includes(sourceName) || !/^[a-z0-9-]+$/i.test(sourceSlug)) throw new Error('Invalid ATS source');
 return {sourceName,sourceSlug, async fetchListings() {
 const sourceUrl=sourceName==='lever' ? `https://api.lever.co/v0/postings/${sourceSlug}?mode=json` : `https://boards-api.greenhouse.io/v1/boards/${sourceSlug}/jobs?content=true`;
 const payload=await fetchJson(sourceUrl);
 const rows=sourceName==='lever'?payload:obj(payload).jobs;
 if(!Array.isArray(rows)) throw new Error('Malformed ATS jobs array');
 return rows.map((raw):RawJobListing=>{
 const p=obj(raw); const lever=sourceName==='lever';
 const lists=Array.isArray(p.lists)?p.lists.map(x=>{const a=obj(x);return `${str(a.text)} ${str(a.content)}`;}).join(' '):'';
 const description=lever?`${str(p.descriptionPlain)||str(p.description)} ${lists} ${str(p.additionalPlain)||str(p.additional)}`:str(p.content);
 const url=str(lever?p.hostedUrl:p.absolute_url); if(!/^https:\/\//.test(url) || p.id == null || !str(lever?p.text:p.title)) throw new Error('Incomplete ATS listing');
 return {sourceName,sourceSlug,sourceJobId:String(p.id),companyName:sourceSlug,roleTitle:str(lever?p.text:p.title),
 locationText:str(lever?obj(p.categories??{}).location:obj(p.location??{}).name),jobDescription:strip(description),applyUrl:url,sourceUrl,
 salaryText: p.salaryRange ? JSON.stringify(p.salaryRange) : undefined, postedAtText:str(p.updated_at)||undefined};
 });
 }};
}
