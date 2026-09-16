import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLocation, normalizeUrl, similarDescription, extractApplicationEmail } from '../src/pipeline/normalization.js';
import { hardFilter, deterministicScore } from '../src/pipeline/deterministic-scoring.js';
import { validateSemantic } from '../src/pipeline/scoring.js';
import { renderDraft } from '../src/pipeline/tailoring.js';
import { candidateProfile } from '../src/config/candidate-profile.js';
import { classifyQuestion } from '../src/pipeline/screening.js';
import { approvalVersion, guardJob, validateRecipient } from '../src/safety/application-guards.js';
import type { DiscoveredJobRecord } from '../src/db/schema.js';
const description='Build Angular frontend applications with TypeScript JavaScript Node.js Express REST GraphQL Angular Signals Nx PrimeNG AWS Docker CI/CD. We require 3-5 years experience.';
const job={roleTitle:'Software Engineer',jobDescription:description,normalizedLocation:'REMOTE_INDIA',jobActive:true};
test('location does not mistake geographically restricted remote work for India remote',()=>{
 for(const [input,expected] of [['Remote India','REMOTE_INDIA'],['Remote - United States','OUTSIDE_INDIA'],['Remote','UNKNOWN'],['Cochin hybrid','KOCHI'],['Ernakulam','KOCHI'],['Technopark','TRIVANDRUM'],['Thiruvananthapuram','TRIVANDRUM'],['Bangalore, India','OTHER_INDIA']]) assert.equal(classifyLocation(input),expected);
});
test('generic titles and secondary React are eligible; internships always fail',()=>{
 assert.equal(hardFilter({...job,jobDescription:description+' React is a bonus.'}),null);
 assert.equal(hardFilter({...job,roleTitle:'Angular Intern'}),'INTERNSHIP');
 assert.equal(hardFilter({...job,roleTitle:'Java Developer',jobDescription:'Java Spring Boot '.repeat(10)}),'JAVA_PRIMARY');
 assert.equal(hardFilter({...job,jobDescription:description.replace('3-5','8-10')}),'EXPERIENCE_TOO_HIGH');
 assert.equal(hardFilter({...job,jobActive:false}),'JOB_CLOSED');
});
test('scoring uses CV evidence and applies geography penalties',()=>{
 assert.ok(deterministicScore(job)>=90);
 assert.ok(deterministicScore({...job,normalizedLocation:'OTHER_INDIA'})<deterministicScore(job));
 assert.ok(deterministicScore({...job,jobDescription:description+' NgRx RxJS Vitest GitHub Actions'})>=deterministicScore(job));
});
test('normalization and substantial description similarity detect duplicates',()=>{
 assert.equal(normalizeUrl('https://example.com/jobs/1?utm_source=foo#x'),'https://example.com/jobs/1');
 assert.ok(similarDescription(description,description+' Apply today'));
 assert.throws(()=>normalizeUrl('javascript:alert(1)'));
});
test('strict semantic validation rejects malformed model output',()=>{
 assert.throws(()=>validateSemantic({semanticScore:105}));
 assert.throws(()=>validateSemantic({semanticScore:'90',confidence:90,reasoning:'ok',strengths:[],gaps:[],riskFlags:[]}));
 assert.equal(validateSemantic({semanticScore:90,confidence:50,reasoning:'ok',strengths:[],gaps:[],riskFlags:[]}).confidence,50);
});
test('drafts cannot invent evidence or metrics',()=>{
 assert.throws(()=>renderDraft('Engineer',['cv-999','cv-1']));
 assert.throws(()=>renderDraft('Engineer',['cv-1','cv-1']));
 const draft=renderDraft('Engineer',['cv-2','cv-3']);
 assert.ok(draft.tailoredEmailBody.includes(candidateProfile.verifiedHighlights[1].statement));
 assert.ok(candidateProfile.verifiedSkills.some(s=>s.name==='NgRx'));
 assert.ok(!candidateProfile.verifiedSkills.some(s=>s.name==='Java')); 
});
test('screening separates verified facts, personal choices and sensitive data',()=>{
 assert.equal(classifyQuestion('What is your full name?').classification,'AUTO_ANSWER');
 assert.equal(classifyQuestion('What is your notice period?').classification,'ASK_USER');
 assert.equal(classifyQuestion('What is your passport number?').classification,'DO_NOT_ANSWER');
 assert.equal(classifyQuestion('How many years of Java experience?').classification,'DO_NOT_ANSWER');
});
test('recipient extraction requires application context and career mailbox',()=>{
 assert.equal(extractApplicationEmail('Privacy contact privacy@example.com'),null);
 assert.equal(extractApplicationEmail('Send your CV to careers@example.com'),'careers@example.com');
 assert.equal(extractApplicationEmail('kindly share your updated resume with us at hr@simelabs.com'),'hr@simelabs.com');
 assert.equal(validateRecipient('careers@gmail.com','Send to careers@gmail.com'),false);
 assert.equal(validateRecipient('hr@evil.com','Apply hr@company.com'),false);
});
test('approval binds exact job, draft and resume; invalid state blocks sending',()=>{
 const j={...job,id:'1',companyName:'example',applicationStatus:'Waiting for approval',contentHash:'a',applyMethod:'email',applyEmailAddress:'careers@example.com',jobDescription:'Send CV to careers@example.com',tailoredEmailBody:'Body',tailoredEmailSubject:'Subject',screeningData:[],updatedAt:new Date()} as unknown as DiscoveredJobRecord;
 assert.doesNotThrow(()=>guardJob(j,'1'));
 assert.throws(()=>guardJob(j,'2'));
 assert.throws(()=>guardJob({...j,applicationStatus:'Applied'},'1'));
 assert.throws(()=>guardJob({...j,jobActive:false},'1'));
 assert.notEqual(approvalVersion(j,'resume1'),approvalVersion(j,'resume2'));
 assert.notEqual(approvalVersion(j,'resume1'),approvalVersion({...j,tailoredEmailBody:'Edited'},'resume1'));
});

test('ATS adapters preserve source identity and full requirement sections',async()=>{
 const {createSource}=await import('../src/sources/ats-sources.js');
 const original=globalThis.fetch;
 try {
 globalThis.fetch=async()=>new Response(JSON.stringify([{id:'one',text:'Engineer',categories:{location:'India Remote'},descriptionPlain:'Introduction',lists:[{text:'Requirements',content:'<p>Angular TypeScript</p>'}],additionalPlain:'More details',hostedUrl:'https://jobs.lever.co/example/one'}]),{status:200});
 const [lever]=await createSource('lever','example').fetchListings();
 assert.equal(lever.sourceJobId,'one');assert.match(lever.jobDescription,/Requirements Angular TypeScript/);
 globalThis.fetch=async()=>new Response(JSON.stringify({jobs:[{id:2,title:'Engineer',location:{name:'Kochi'},content:'&lt;p&gt;Angular requirements&lt;/p&gt;',absolute_url:'https://boards.greenhouse.io/example/jobs/2'}]}),{status:200});
 const [greenhouse]=await createSource('greenhouse','example').fetchListings();assert.equal(greenhouse.jobDescription,'Angular requirements');
 globalThis.fetch=async()=>new Response('{}',{status:404});
 await assert.rejects(()=>createSource('greenhouse','invalid').fetchListings(),/404/);
 } finally {globalThis.fetch=original;}
});

test('jobs without Angular relevance cannot cross the qualification threshold',()=>{
 const score=deterministicScore({...job,jobDescription:description.replace(/Angular/gi,''),roleTitle:'Frontend Engineer'});
 assert.ok(score*.6+100*.4<75);
});

test('career addresses must belong to the company rather than a lookalike domain',async()=>{
 const {recipientMatchesCompany}=await import('../src/safety/application-guards.js');
 assert.equal(recipientMatchesCompany('careers@example.com','example'),true);
 assert.equal(recipientMatchesCompany('careers@example-attacker.com','example'),false);
 assert.equal(recipientMatchesCompany('careers@unrelated.com','example'),false);
});
