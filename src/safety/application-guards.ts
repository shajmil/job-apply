import { hash } from '../pipeline/normalization.js';
import type { DiscoveredJobRecord } from '../db/schema.js';
import { registrableDomain } from '../sources/html.js';
export function approvalVersion(j:DiscoveredJobRecord, resumeHash:string):string {
 return hash(JSON.stringify([j.id,j.contentHash,j.applyEmailAddress,j.applyUrl,j.tailoredEmailSubject,j.tailoredEmailBody,j.screeningData,j.updatedAt,resumeHash]));
}
export function validateRecipient(email:string, description:string): boolean {
 if(!/^(careers?|jobs|recruitment|recruiting|talent|hr)@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) return false;
 if(/@(gmail|yahoo|outlook|hotmail)\./i.test(email)) return false;
 return description.toLowerCase().includes(email.toLowerCase());
}
export function guardJob(j:DiscoveredJobRecord, approvedId:string) {
 if(j.id!==approvedId) throw new Error('Approval job mismatch');
 if(j.applicationStatus!=='Waiting for approval') throw new Error('Job is not waiting for approval');
 if(!j.jobActive) throw new Error('Job is closed');
 if(j.applyMethod!=='email'||!j.applyEmailAddress) throw new Error('This application requires manual ATS submission');
 if(!validateRecipient(j.applyEmailAddress,j.jobDescription) || !recipientMatchesCompany(j.applyEmailAddress, j.companyName, j.companyDomain)) throw new Error('Recipient is not a verified application contact');
 if(!j.tailoredEmailBody||!j.tailoredEmailSubject) throw new Error('Draft is missing');
 if(j.screeningData?.some(q=>q.classification==='ASK_USER'&&!q.answer)) throw new Error('Screening answers require review');
}

const LEGAL_WORDS=new Set(['pvt','private','ltd','limited','llp','llc','inc','co','corp','corporation','company','the']);
// With a source-published employer website, the mailbox must be on that organisation's domain and nothing else counts.
// Otherwise the domain name must spell the company's leading words exactly ("careers@shellsquare.com" for
// "ShellSquare Softwares (P) Ltd"), so lookalikes such as "example-attacker.com" never match "Example".
export function recipientMatchesCompany(email:string, company:string, companyDomain?:string|null):boolean {
 const host=email.split('@')[1]?.toLowerCase();
 if(!host) return false;
 if(companyDomain) return registrableDomain(host)===registrableDomain(companyDomain);
 const label=registrableDomain(host).split('.')[0].replace(/[^a-z0-9]/g,'');
 const words=company.toLowerCase().replace(/\([^)]*\)/g,' ').split(/[^a-z0-9]+/).filter(w=>w&&!LEGAL_WORDS.has(w));
 if(label.length<3) return false;
 for(let k=1;k<=words.length;k++) if(words.slice(0,k).join('')===label) return true;
 return false;
}
