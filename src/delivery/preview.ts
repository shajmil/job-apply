import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import { env } from '../config/env.js';
import type { DiscoveredJobRecord } from '../db/schema.js';
import { approvalVersion } from '../safety/application-guards.js';
import { scoreBreakdown, reviewPolicy } from '../pipeline/deterministic-scoring.js';
export async function resume() {
 const path=env.resumePath(); if(!path) throw new Error('RESUME_PATH is not configured');
 const data=await readFile(path); if(data.subarray(0,5).toString()!=='%PDF-') throw new Error('Resume must be a PDF');
 return {data,filename:basename(path),hash:createHash('sha256').update(data).digest('hex')};
}
export async function preview(j:DiscoveredJobRecord) {
 // The evidence breakdown is recomputed with the current rules so the explanation always matches today's scoring.
 const scoreExplanation=scoreBreakdown(j); const matchingPolicy=reviewPolicy(j);
 try { const r=await resume();return {...j,scoreExplanation,matchingPolicy,resumeFilename:r.filename,approvalVersion:approvalVersion(j,r.hash),sendingEnabled:env.sendingEnabled()}; }
 catch(e){return {...j,scoreExplanation,matchingPolicy,resumeFilename:null,approvalVersion:null,sendingEnabled:env.sendingEnabled(),resumeError:String(e)};}
}
