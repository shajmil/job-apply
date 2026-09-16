import type { DiscoveredJobRecord } from '../db/schema.js';
import { createSource } from '../sources/registry.js';
import { readBatch, type RawJobListing } from '../sources/job-source.js';
import { normalizeListing, extractApplicationEmail } from './normalization.js';
export async function verifyJob(j:DiscoveredJobRecord) {
 if(!j.sourceSlug||!j.sourceJobId) throw new Error('Missing source identity');
 const source=createSource(j.sourceName,j.sourceSlug);
 let raw: RawJobListing | null | undefined;
 try {
 raw=source.fetchListing
 ?await source.fetchListing({sourceJobId:j.sourceJobId,sourceUrl:j.sourceUrl,locationText:j.locationText})
 :(await readBatch(source)).listings.find(r=>r.sourceJobId===j.sourceJobId);
 } catch(e) {
 throw Object.assign(new Error(`Could not re-verify the listing on ${j.sourceName}/${j.sourceSlug}: ${e instanceof Error?e.message:String(e)}`),{status:(e as {status?:number}).status});
 }
 if(!raw) throw new Error('Job is no longer active');
 const fresh=normalizeListing(raw);
 if(fresh.roleTitle!==j.roleTitle||fresh.locationText!==j.locationText||fresh.contentHash!==j.contentHash||fresh.applyUrl!==j.applyUrl||extractApplicationEmail(fresh.jobDescription)!==j.applyEmailAddress) throw new Error('Listing changed; rediscover and review before applying');
 return fresh;
}
