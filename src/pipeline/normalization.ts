import { candidateProfile } from '../config/candidate-profile.js';
import { createHash } from 'node:crypto';
import type { RawJobListing } from '../sources/job-source.js';
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export const normalizeText = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#.]+/g,' ').trim();
export function normalizeUrl(s: string): string { const u=new URL(s); if(u.protocol!=='https:') throw new Error('HTTPS job URL required'); u.hash=''; for(const key of [...u.searchParams.keys()]) if(/^(utm_|ref|source)/i.test(key)) u.searchParams.delete(key); return u.toString().replace(/\/$/,''); }
// Regions and countries that establish a non-India location. APAC is deliberately absent because it includes India.
const foreignLocation=/\b(us|u\.s\.|usa|united states|americas|north america|latam|latin america|canada|mexico|brazil|argentina|colombia|chile|peru|bolivia|ecuador|uruguay|paraguay|venezuela|costa rica|panama|guatemala|puerto rico|united kingdom|uk|england|scotland|ireland|emea|europe|germany|france|spain|portugal|netherlands|poland|italy|sweden|denmark|norway|finland|switzerland|austria|belgium|luxembourg|czech republic|czechia|slovakia|hungary|romania|bulgaria|serbia|croatia|slovenia|greece|ukraine|lithuania|latvia|estonia|turkey|israel|egypt|morocco|uae|dubai|abu dhabi|saudi arabia|qatar|kuwait|bahrain|oman|pakistan|bangladesh|sri lanka|nepal|australia|new zealand|singapore|japan|korea|china|hong kong|taiwan|thailand|philippines|vietnam|indonesia|malaysia|south africa|nigeria|kenya|london|berlin|paris|amsterdam|toronto|new york|san francisco|dallas|seattle)\b/;
export function classifyLocation(s: string): string {
 const t=s.toLowerCase();
 if(/relocat/.test(t)) return 'RELOCATION_REQUIRED';
 const india=/\bindia\b/.test(t)||/kochi|cochin|ernakulam|infopark|kakkanad|trivandrum|thiruvananthapuram|technopark|kerala|thrissur|kozhikode|calicut|cherthala|bengaluru|bangalore|chennai|mumbai|pune|hyderabad|delhi|gurgaon|gurugram|noida|ghaziabad|faridabad|ahmedabad|gandhinagar|vadodara|surat|coimbatore|madurai|trichy|mysore|mysuru|mangalore|mangaluru|indore|bhopal|jaipur|chandigarh|mohali|kolkata|bhubaneswar|nagpur|nashik|lucknow|visakhapatnam|vizag|dehradun|\bgoa\b/.test(t);
 if(foreignLocation.test(t)&&!india) return 'OUTSIDE_INDIA';
 if(/remote|work from home/.test(t) && (/\bindia\b/.test(t) || /worldwide|anywhere|global/.test(t))) return 'REMOTE_INDIA';
 if(/kochi|cochin|ernakulam|infopark|kakkanad/.test(t)) return 'KOCHI';
 if(/trivandrum|thiruvananthapuram|technopark/.test(t)) return 'TRIVANDRUM';
 if(india) return 'OTHER_INDIA';
 return 'UNKNOWN';
}
export function normalizeListing(j: RawJobListing) {
 const applyUrl=normalizeUrl(j.applyUrl); const description=j.jobDescription.replace(/\s+/g,' ').trim();
 // Some listings state remote work only in the title ("Angular Developer (Remote)") or in a labelled line of the
 // description ("Work Mode: Online"), while the location is just a city or an IT park campus.
 const remoteStated=/\bremote\b/i.test(j.roleTitle)||/\b(?:work\s*mode|work\s*type|job\s*type|mode\s*of\s*work|location)\s*:\s*(?:fully\s+)?(?:remote|online|work\s*from\s*home|wfh)\b/i.test(description);
 const place=remoteStated&&!/remote|hybrid|on-?site/i.test(j.locationText)?`${j.locationText} remote`:j.locationText;
 const normalizedLocation=classifyLocation(place);
 const workMode=/hybrid/i.test(place)?'hybrid':/remote|work from home/i.test(place)?'remote':j.locationText?'onsite':'unknown';
 return {...j,applyUrl,jobDescription:description,normalizedLocation,workMode,
 salaryText:j.salaryText??description.match(/(?:INR|Rs\.?|₹)?\s*\d+(?:\.\d+)?\s*(?:[-–]\s*\d+(?:\.\d+)?)?\s*(?:LPA|lakhs?)/i)?.[0],
 detectedTechnologies:candidateProfile.verifiedSkills.filter(s=>description.toLowerCase().includes(s.name.toLowerCase())).map(s=>s.name),
 contentHash:hash(normalizeText(description)),
 normalizedFingerprint:hash([j.companyName,j.roleTitle,j.locationText].map(normalizeText).join('|')),
 id:hash(`${j.sourceName}|${j.sourceSlug}|${j.sourceJobId}`).slice(0,24)};
}
export function similarDescription(a: string,b: string): boolean {
 const x=new Set(normalizeText(a).split(' ')), y=new Set(normalizeText(b).split(' '));
 return [...x].filter(t=>y.has(t)).length / Math.max(1,new Set([...x,...y]).size) >= .85;
}
export function extractApplicationEmail(text: string): string | null {
 // "kindly share your updated resume with us at hr@company.com" is as explicit as "apply to".
 const match=text.match(/(?:apply|send|submit|email|contact|share|forward|mail)[^.]{0,100}?\b((?:careers?|jobs|recruitment|recruiting|talent|hr)@[a-z0-9.-]+\.[a-z]{2,})/i);
 return match?.[1].toLowerCase()??null;
}
export function experienceText(range: {min:number;max:number}|null): string|null {
 if(!range) return null;
 return range.max>=99?`${range.min}+ years`:`${range.min}–${range.max} years`;
}
export const applyMethodFor = (email: string|null) => email ? 'email' : 'ats_form';
export function experienceRange(text: string): {min:number;max:number}|null {
 const m=text.match(/(\d+)\s*(?:-|–|to)\s*(\d+)\s*(?:years?|yrs?)\b/i);
 if(m) return {min:Number(m[1]),max:Number(m[2])};
 // "Experience: 5+ Years", "Proven expertise in Angular (2+ years preferred)"
 const labelled=text.match(/\b(?:experience|expertise|exp)\b[^.\n]{0,40}?(\d+)\s*\+?\s*(?:years?|yrs?)\b/i);
 if(labelled) return {min:Number(labelled[1]),max:99};
 const n=text.match(/(\d+)\s*\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:professional\s+|relevant\s+|hands-on\s+)?experience/i);
 return n?{min:Number(n[1]),max:99}:null;
}
