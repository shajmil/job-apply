export interface RawJobListing {
 sourceName: string; sourceSlug: string; sourceJobId: string; companyName: string;
 roleTitle: string; locationText: string; jobDescription: string; applyUrl: string;
 sourceUrl: string; postedAtText?: string; salaryText?: string;
 // Company website published by the source itself, used to confirm an application mailbox belongs to the employer.
 companyDomain?: string;
}
export interface StoredListing { sourceJobId: string; sourceUrl: string | null; locationText: string | null }
export interface SourceBatch {
 listings: RawJobListing[];
 // Every listing identity the source reported, including ones not returned (title-filtered or failed detail fetches).
 seenIds: Set<string>;
 // True only when the whole board was read, so listings missing from seenIds can be treated as closed.
 complete: boolean;
 ignored?: number;
 // Detail pages that could not be read or parsed this run.
 failedDetails?: number;
}
export interface JobSource {
 sourceName: string; sourceSlug: string;
 fetchListings(): Promise<RawJobListing[]>;
 fetchBatch?(): Promise<SourceBatch>;
 // Re-reads one listing before an application is sent. Returns null when the listing is gone.
 // The stored record supplies context a detail page cannot restate, such as the campus a listing was found under.
 fetchListing?(stored: StoredListing): Promise<RawJobListing | null>;
}
export async function readBatch(source: JobSource): Promise<SourceBatch> {
 if(source.fetchBatch) return source.fetchBatch();
 const listings=await source.fetchListings();
 return {listings,seenIds:new Set(listings.map(l=>l.sourceJobId)),complete:true};
}
