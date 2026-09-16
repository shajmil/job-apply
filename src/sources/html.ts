import type { RawJobListing } from './job-source.js';
const named: Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ndash:'–',mdash:'—',rsquo:'’',lsquo:'‘',rdquo:'”',ldquo:'“',hellip:'…',bull:'•',middot:'·'};
export function decodeEntities(s: string): string {
 return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(m,code:string)=>{
 if(code[0]==='#') { const n=code[1].toLowerCase()==='x'?parseInt(code.slice(2),16):Number(code.slice(1)); return Number.isFinite(n)&&n>0?String.fromCodePoint(n):m; }
 return named[code.toLowerCase()]??m;
 });
}
// Keeps paragraph and list boundaries as line breaks so requirement lists stay readable.
export function htmlToText(html: string): string {
 const withBreaks=html.replace(/<(script|style)[\s\S]*?<\/\1>/gi,' ').replace(/<br\s*\/?>/gi,'\n').replace(/<\/(p|div|li|h[1-6]|tr|ul|ol)>/gi,'\n').replace(/<li[^>]*>/gi,'- ');
 return decodeEntities(withBreaks.replace(/<[^>]+>/g,' ')).replace(/[ \t\f\v]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
export const httpsUrl=(value: string, base?: string): string | null => { try { const u=new URL(value,base); return u.protocol==='https:'?u.toString():null; } catch { return null; } };
export const hostDomain=(value: string | undefined | null): string | undefined => { if(!value) return undefined; try { return new URL(/^https?:/i.test(value)?value:`https://${value}`).hostname.replace(/^www\./,'').toLowerCase(); } catch { return undefined; } };
// The organisation-level domain: "careers.acme.co.in" becomes "acme.co.in".
export function registrableDomain(host: string): string {
 const labels=host.toLowerCase().replace(/^www\./,'').split('.').filter(Boolean);
 const secondLevel=/^(co|com|org|net|gov|ac|edu)$/.test(labels[labels.length-2]??'')&&(labels[labels.length-1]??'').length===2;
 return labels.slice(secondLevel?-3:-2).join('.');
}
// Hosted hiring platforms and job boards serve many employers, so their domains never identify one company.
export const isJobPlatformDomain=(domain: string)=>/(^|\.)(lever\.co|greenhouse\.io|workable\.com|smartrecruiters\.com|ashbyhq\.com|zohorecruit\.(com|in)|freshteam\.com|keka\.com|darwinbox\.(com|in)|bamboohr\.com|recruitee\.com|breezy\.hr|jobvite\.com|icims\.com|myworkdayjobs\.com|successfactors\.com|taleo\.net|cutshort\.io|hirist\.tech|naukri\.com|linkedin\.com|indeed\.com|glassdoor\.(com|co\.in)|infopark\.in|technopark\.in)$/.test(domain);
export function slugify(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60)||'site'; }
// Returns every schema.org JobPosting embedded as JSON-LD, including ones nested in @graph or arrays.
export function jsonLdJobPostings(html: string): Array<Record<string, unknown>> {
 const found: Array<Record<string, unknown>>=[];
 const visit=(v: unknown)=>{
 if(Array.isArray(v)) { v.forEach(visit); return; }
 if(!v||typeof v!=='object') return;
 const o=v as Record<string, unknown>, type=o['@type'];
 if(type==='JobPosting'||(Array.isArray(type)&&type.includes('JobPosting'))) found.push(o);
 if(o['@graph']) visit(o['@graph']);
 };
 for(const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
 try { visit(JSON.parse(m[1].trim())); } catch { /* malformed blocks on third-party pages are ignored */ }
 }
 return found;
}
const text=(v: unknown): string => typeof v==='string'?v:typeof v==='number'?String(v):'';
const asArray=(v: unknown): unknown[] => Array.isArray(v)?v:v==null?[]:[v];
function locationOf(p: Record<string, unknown>): string {
 const places=asArray(p.jobLocation).map(place=>{
 const address=((place as Record<string, unknown>)?.address??{}) as Record<string, unknown>;
 const country=text(address.addressCountry)||text((address.addressCountry as Record<string, unknown>)?.name);
 return [text(address.addressLocality),text(address.addressRegion),country==='IN'?'India':country].filter(Boolean).join(', ');
 }).filter(Boolean);
 if(text(p.jobLocationType).toUpperCase()==='TELECOMMUTE') {
 const allowed=asArray(p.applicantLocationRequirements).map(r=>text((r as Record<string, unknown>)?.name)).filter(Boolean);
 places.unshift(`Remote${allowed.length?`, ${allowed.map(c=>c==='IN'?'India':c).join(', ')}`:''}`);
 }
 return [...new Set(places)].join('; ');
}
function salaryOf(p: Record<string, unknown>): string | undefined {
 const base=(p.baseSalary??{}) as Record<string, unknown>, value=(base.value??{}) as Record<string, unknown>;
 const min=Number(value.minValue??value.value), max=Number(value.maxValue??value.value);
 if(!Number.isFinite(min)||min<=0) return undefined;
 if(text(base.currency)==='INR'&&text(value.unitText).toUpperCase()==='YEAR') {
 const lakhs=(n: number)=>Math.round(n/1e4)/10;
 return max>min?`${lakhs(min)}-${lakhs(max)} LPA`:`${lakhs(min)} LPA`;
 }
 return `${text(base.currency)} ${min}${max>min?`-${max}`:''} per ${text(value.unitText).toLowerCase()||'period'}`.trim();
}
export interface JobPostingContext { sourceName: string; sourceSlug: string; pageUrl: string; sourceUrl?: string; now?: Date }
// Maps a JobPosting to a listing. Expired postings (validThrough in the past) and incomplete ones return null.
export function listingFromJobPosting(p: Record<string, unknown>, ctx: JobPostingContext): RawJobListing | null {
 const validThrough=Date.parse(text(p.validThrough));
 if(Number.isFinite(validThrough)&&validThrough<(ctx.now??new Date()).getTime()) return null;
 const title=decodeEntities(text(p.title)).trim(), description=htmlToText(text(p.description));
 const org=(p.hiringOrganization??{}) as Record<string, unknown>;
 const applyUrl=httpsUrl(text(p.url)||ctx.pageUrl,ctx.pageUrl);
 if(!title||!description||!applyUrl) return null;
 // Job-board profile links are not employer websites and must not vouch for a recipient domain.
 const employerDomain=[...asArray(org.url),...asArray(org.sameAs)].map(v=>hostDomain(text(v))).find(d=>d&&!isJobPlatformDomain(d)&&!/ambitionbox|facebook|twitter|x\.com|instagram|youtube/.test(d));
 const identifier=p.identifier as Record<string, unknown> | string | undefined;
 const id=(typeof identifier==='object'?text(identifier?.value):text(identifier))||new URL(applyUrl).pathname;
 const months=Number(((p.experienceRequirements??{}) as Record<string, unknown>).monthsOfExperience);
 // Structured experience is restated in words so the same experience rules apply as for free-text listings.
 const experience=Number.isFinite(months)&&months>0?`Experience required: ${Math.floor(months/12)}+ years experience.\n`:'';
 return {sourceName:ctx.sourceName,sourceSlug:ctx.sourceSlug,sourceJobId:id,companyName:decodeEntities(text(org.name)).trim()||ctx.sourceSlug,
 roleTitle:title,locationText:locationOf(p),jobDescription:experience+description,applyUrl,sourceUrl:ctx.sourceUrl??ctx.pageUrl,
 postedAtText:text(p.datePosted)||undefined,salaryText:salaryOf(p),companyDomain:employerDomain};
}
