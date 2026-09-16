import { retry } from '../utils/retry.js';
// An honest, identifiable agent string. Sources are never accessed with a spoofed browser identity.
export const USER_AGENT='JobSearchAgent/2.0 (personal job search; respects robots.txt)';
const AGENT_TOKEN='jobsearchagent';
export interface RobotsRules { rules: Array<{allow: boolean; pattern: string}>; crawlDelaySeconds: number | null }
export function parseRobots(text: string): RobotsRules {
 const groups: Array<{agents: string[]; rules: RobotsRules['rules']; crawlDelaySeconds: number | null}>=[];
 let current: (typeof groups)[number] | null=null, collectingAgents=false;
 for(const rawLine of text.split(/\r?\n/)) {
 const line=rawLine.replace(/#.*/,'').trim(); if(!line) continue;
 const i=line.indexOf(':'); if(i<0) continue;
 const key=line.slice(0,i).trim().toLowerCase(), value=line.slice(i+1).trim();
 if(key==='user-agent') {
 if(!current||!collectingAgents) { current={agents:[],rules:[],crawlDelaySeconds:null}; groups.push(current); }
 current.agents.push(value.toLowerCase()); collectingAgents=true; continue;
 }
 collectingAgents=false; if(!current) continue;
 if(key==='allow'||key==='disallow') { if(value) current.rules.push({allow:key==='allow',pattern:value}); }
 else if(key==='crawl-delay') { const n=Number(value); if(Number.isFinite(n)&&n>=0) current.crawlDelaySeconds=n; }
 }
 // The most specific matching group applies; otherwise the wildcard group.
 const group=groups.find(g=>g.agents.some(a=>a!=='*'&&AGENT_TOKEN.includes(a)))??groups.find(g=>g.agents.includes('*'));
 return {rules:group?.rules??[],crawlDelaySeconds:group?.crawlDelaySeconds??null};
}
function patternMatches(pattern: string, path: string): boolean {
 const anchored=pattern.endsWith('$'), body=anchored?pattern.slice(0,-1):pattern;
 const regex=new RegExp('^'+body.split('*').map(part=>part.replace(/[.+?^${}()|[\]\\]/g,'\\$&')).join('.*')+(anchored?'$':''));
 return regex.test(path);
}
// Longest matching rule wins; Allow wins a tie, as in Google's robots.txt specification.
export function isAllowed(robots: RobotsRules, pathAndQuery: string): boolean {
 let best: {allow: boolean; length: number} | null=null;
 for(const r of robots.rules) if(patternMatches(r.pattern,pathAndQuery)) {
 const length=r.pattern.length;
 if(!best||length>best.length||(length===best.length&&r.allow)) best={allow:r.allow,length};
 }
 return best?.allow??true;
}
const robotsCache=new Map<string,Promise<RobotsRules>>();
const nextSlot=new Map<string,number>();
async function robotsFor(origin: string): Promise<RobotsRules> {
 if(!robotsCache.has(origin)) robotsCache.set(origin,(async()=>{
 const r=await fetch(`${origin}/robots.txt`,{headers:{'User-Agent':USER_AGENT},signal:AbortSignal.timeout(20000)}).catch(()=>null);
 // A missing robots.txt (4xx) permits access; a server error or network failure blocks fetching until it can be read.
 if(!r) throw Object.assign(new Error(`robots.txt unreachable for ${origin}`),{status:503});
 if(r.status>=500) throw Object.assign(new Error(`robots.txt unavailable for ${origin}`),{status:r.status});
 return r.ok?parseRobots(await r.text()):{rules:[],crawlDelaySeconds:null};
 })());
 return robotsCache.get(origin)!;
}
export class RobotsDisallowedError extends Error { readonly status=451; }
// Enforces robots.txt and waits for this host's next request slot (its Crawl-delay, never less than minDelayMs).
// Browser-rendered pages use this too, so a rendered visit is paced like a plain request.
export async function awaitPoliteSlot(url: string, minDelayMs=1000): Promise<void> {
 const u=new URL(url);
 const robots=await robotsFor(u.origin);
 if(!isAllowed(robots,u.pathname+u.search)) throw new RobotsDisallowedError(`robots.txt disallows ${u.pathname}`);
 const delay=Math.max((robots.crawlDelaySeconds??0)*1000,minDelayMs);
 const now=Date.now(), slot=Math.max(now,nextSlot.get(u.host)??0);
 nextSlot.set(u.host,slot+delay);
 if(slot>now) await new Promise(r=>setTimeout(r,slot-now));
}
export async function politeFetch(url: string, options: {accept?: string; minDelayMs?: number} = {}): Promise<Response> {
 const u=new URL(url);
 await awaitPoliteSlot(url,options.minDelayMs);
 return retry(async()=>{
 const r=await fetch(url,{headers:{'User-Agent':USER_AGENT,Accept:options.accept??'text/html,application/json;q=0.9,*/*;q=0.5'},signal:AbortSignal.timeout(30000)});
 if(!r.ok) throw Object.assign(new Error(`HTTP ${r.status} for ${u.pathname}`),{status:r.status});
 return r;
 });
}
export const politeText=async(url: string, options?: {minDelayMs?: number})=>(await politeFetch(url,options)).text();
export async function politeJson(url: string, options?: {minDelayMs?: number}): Promise<unknown> {
 const r=await politeFetch(url,{...options,accept:'application/json'});
 try { return await r.json(); } catch { throw Object.assign(new Error('Malformed source JSON'),{status:422}); }
}
export async function crawlDelayMs(origin: string): Promise<number> { return ((await robotsFor(origin)).crawlDelaySeconds??0)*1000; }
