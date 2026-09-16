import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, sep } from 'node:path';
import { parseModelJson } from '../src/pipeline/llm.js';
import { errorCategory } from '../src/utils/retry.js';
import { classifyLocation, experienceText } from '../src/pipeline/normalization.js';
import { deterministicScore, preSemanticSkipReason, blendScore } from '../src/pipeline/deterministic-scoring.js';
import { classifyQuestion } from '../src/pipeline/screening.js';
import { pickExisting } from '../src/pipeline/discovery.js';
import { sourceHealth } from '../src/dashboard/metrics.js';
import { resolveStaticPath } from '../src/dashboard/server.js';
const description='Build Angular frontend applications with TypeScript JavaScript Node.js Express REST GraphQL Angular Signals Nx PrimeNG AWS Docker CI/CD. We require 3-5 years experience.';
const job={roleTitle:'Software Engineer',jobDescription:description,normalizedLocation:'REMOTE_INDIA',jobActive:true};

test('model JSON is accepted inside code fences or prose, and missing JSON is rejected',()=>{
 assert.deepEqual(parseModelJson('```json\n{"semanticScore":80}\n```'),{semanticScore:80});
 assert.deepEqual(parseModelJson('Here is the result: {"highlightIds":["cv-1","cv-2"]}'),{highlightIds:['cv-1','cv-2']});
 assert.throws(()=>parseModelJson('I cannot evaluate this job.'),SyntaxError);
});

test('errors are categorised as retryable outages or permanent failures',()=>{
 assert.equal(errorCategory(Object.assign(new Error('rate'),{status:429})),'retryable');
 assert.equal(errorCategory(Object.assign(new Error('down'),{status:503})),'retryable');
 assert.equal(errorCategory(new TypeError('fetch failed')),'retryable');
 assert.equal(errorCategory(Object.assign(new Error('missing'),{status:404})),'permanent');
 assert.equal(errorCategory(new SyntaxError('bad json')),'permanent');
});

test('regional remote listings outside India are excluded while India locations are kept',()=>{
 for(const [input,expected] of [['Remote, EMEA','OUTSIDE_INDIA'],['Remote - Spain','OUTSIDE_INDIA'],['Remote, US','OUTSIDE_INDIA'],['Remote, APAC','UNKNOWN'],['Hybrid in Bangalore, India','OTHER_INDIA'],['Kochi, Kerala, India','KOCHI'],['Remote - India or US','REMOTE_INDIA']]) assert.equal(classifyLocation(input),expected,input);
});

test('countries seen on live boards are outside India, and remote stated only in the title counts',async()=>{
 for(const input of ['Peru','Pakistan','Thailand - Bangkok','Slovakia - Kosice','Bulgaria','Serbia','Czech Republic - Brno']) assert.equal(classifyLocation(input),'OUTSIDE_INDIA',input);
 const {normalizeListing}=await import('../src/pipeline/normalization.js');
 const raw={sourceName:'lever',sourceSlug:'x',sourceJobId:'1',companyName:'x',roleTitle:'Angular Developer (Remote, Full-Time)',locationText:'India',jobDescription:description,applyUrl:'https://jobs.lever.co/x/1',sourceUrl:'https://api.lever.co/v0/postings/x'};
 assert.equal(normalizeListing(raw).normalizedLocation,'REMOTE_INDIA');
 assert.equal(normalizeListing(raw).workMode,'remote');
 assert.equal(normalizeListing({...raw,roleTitle:'Angular Developer (Remote)',locationText:'Pakistan'}).normalizedLocation,'OUTSIDE_INDIA');
});

test('an Angular expert role taught online with "2+ years preferred" is not skipped before semantic scoring',async()=>{
 const {normalizeListing,experienceRange}=await import('../src/pipeline/normalization.js');
 const text='Nestsoft TechnoMaster is seeking a highly skilled Angular Expert to provide online training and consulting on an hourly basis. Requirements: Proven expertise in Angular (2+ years preferred). Strong understanding of TypeScript, HTML, CSS, RxJS, and Angular CLI. Work Mode: Online (Hourly Basis). Send your resume to hr@nestsoft.com';
 const n=normalizeListing({sourceName:'infopark',sourceSlug:'kerala',sourceJobId:'1',companyName:'Nestsoft TechnoMaster PVT LTD',roleTitle:'Angular Expert',locationText:'Infopark Phase 1, Kakkanad, Kochi, Kerala, India',jobDescription:text,applyUrl:'https://infopark.in/company-jobs/details/1/1',sourceUrl:'https://infopark.in/company-jobs/details/1/1'});
 assert.deepEqual(experienceRange(text),{min:2,max:99});
 assert.equal(n.normalizedLocation,'REMOTE_INDIA');
 assert.equal(n.workMode,'remote');
 assert.equal(preSemanticSkipReason(n,deterministicScore(n)),null);
 assert.deepEqual(experienceRange('Experience: 5+ Years\nEmployment Type: Full-Time'),{min:5,max:99});
 assert.deepEqual(experienceRange('Software Engineer – AI : Exp-6+ Yrs || REMOTE'),{min:6,max:99});
 assert.equal(normalizeListing({...n,locationText:'Kochi',jobDescription:'Location: Kochi - Work from office. '+text.replace('Work Mode: Online (Hourly Basis).','')}).workMode,'onsite');
});

test('user-reviewed listings: Angular mentions are visible unless experience exceeds the user limit',async()=>{
 const {angularRelevance,scoreBreakdown}=await import('../src/pipeline/deterministic-scoring.js');
 const {normalizeListing}=await import('../src/pipeline/normalization.js');
 const kochi='Infopark Phase 1, Kakkanad, Kochi, Kerala, India';
 const make=(roleTitle: string, jobDescription: string)=>normalizeListing({sourceName:'infopark',sourceSlug:'kerala',sourceJobId:roleTitle,companyName:'x',roleTitle,locationText:kochi,jobDescription,applyUrl:'https://infopark.in/company-jobs/details/1/2',sourceUrl:'https://infopark.in/company-jobs/details/1/2'});
 const tnp=make('Full Stack Developer- Senior','We are seeking an experienced Developer with a strong background in Angular/ React.js, Next.js, Node.js/Python for Api development, and SQL. Position: Sr. Full Stack Developer Experience: 4-5 years Technology Stack: Angular/React.js, Next.js, Node.js, Python, SQL. Develop responsive web applications using React.js, Next.js, Node.js, Python, HTML, CSS, and JavaScript. Strong proficiency in React.js and its respective ecosystem. Experience with SQL-based databases like MySQL. Experience with RESTful APIs. Experience in Docker, Kubernetes, and CI/CD will be an add-on.');
 const nest=make('Nest JS Developer','Design, build and maintain RESTful (and where applicable GraphQL) APIs in NestJS that serve the Angular citizen portal. Document APIs using OpenAPI/Swagger for consumption by the Angular team. 4–5 years of overall software development experience, including at least 2–3 years of hands-on NestJS/Node.js development. Strong command of TypeScript and modern JavaScript (ES6+). Working familiarity with Angular, to support smooth collaboration with the frontend team. Proficiency with relational databases (MongoDB, IBM DB2). Exposure to CI/CD pipelines.');
 const python=make('Python Technical Lead','Techversant offers expertize in ColdFusion, Python, Java, .NET, Node JS, PHP, Angular, React Vue. Experience & Qualifications 7+ years of software engineering experience with strong hands-on development expertise in Python. Strong expertise in Python and frameworks such as Django, Flask, FastAPI. Frontend collaboration with working knowledge of HTML5, CSS, JavaScript, and frameworks such as ReactJS and Angular. Experience with Docker, Kubernetes, CI/CD pipelines.');
 assert.equal(angularRelevance(tnp.roleTitle,tnp.jobDescription),'strong');
 assert.equal(angularRelevance(nest.roleTitle,nest.jobDescription),'weak');
 assert.equal(angularRelevance(python.roleTitle,python.jobDescription),'weak');
 assert.equal(preSemanticSkipReason(tnp,deterministicScore(tnp)),null);
 assert.ok(!scoreBreakdown(tnp).items.some(i=>/React is the main/.test(i.label)),'Angular offered as an alternative to React is not a React-primary role');
 assert.equal(preSemanticSkipReason(nest,deterministicScore(nest)),null);
 assert.ok(scoreBreakdown(nest).items.some(i=>/another stack/.test(i.label)));
 assert.equal(preSemanticSkipReason(python,deterministicScore(python)),'EXPERIENCE_TOO_HIGH');
 assert.equal(angularRelevance('Frontend Developer','Frontend: Angular 17, TypeScript'),'strong');
 assert.equal(angularRelevance('Web Developer','Our company works with AngularJS and jQuery'),'weak');
});

test('user-reviewed listings: Java-primary full-stack roles above the candidate experience are held back',async()=>{
 const {scoreBreakdown,requiredOtherStack}=await import('../src/pipeline/deterministic-scoring.js');
 const {normalizeListing}=await import('../src/pipeline/normalization.js');
 const make=(roleTitle: string, jobDescription: string)=>normalizeListing({sourceName:'infopark',sourceSlug:'kerala',sourceJobId:roleTitle,companyName:'x',roleTitle,locationText:'Infopark Phase 1, Kakkanad, Kochi, Kerala, India',jobDescription,applyUrl:'https://infopark.in/company-jobs/details/1/3',sourceUrl:'https://infopark.in/company-jobs/details/1/3'});
 const webdura=make('Full Stack Developer( Java +Angular)','Job Type: Full-Time Experience: 5+ Years Location: Hybrid. The ideal candidate should have strong expertise in Java backend development, Angular frontend development, RESTful APIs, microservices architecture. Build responsive, dynamic, and reusable UI components using Angular. Develop robust backend services and RESTful APIs using Java and Spring Boot. Strong proficiency in Java (Java 8/11/17+). Hands-on experience with Spring Boot, Spring MVC, Spring Security. Strong experience in Angular (Angular 12+ preferred). Proficiency in TypeScript, JavaScript, HTML5, CSS3, and Bootstrap/Angular Material. Experience with Docker and Kubernetes. CI/CD tools such as GitHub Actions.');
 const ctebs=make('Software Engineer','Translate technical design documents into clean, maintainable Java/J2EE code. Build and maintain Angular components while adhering to the established standards. 5 to 7 years of professional software development experience. Working knowledge of Angular component architecture and RESTful API integration. Proficiency in Java/J2EE — Spring Boot, Hibernate, and Multithreading. Hands-on experience with CI/CD pipelines. Exposure to Docker is a plus.');
 for(const [job,label] of [[webdura,'Webdura'],[ctebs,'CTeBS']] as const) {
 const b=scoreBreakdown(job);
 assert.equal(preSemanticSkipReason(job,b.total),'EXPERIENCE_TOO_HIGH',label);
 assert.ok(b.items.some(i=>/Requires Java\/Spring as a main skill/.test(i.label)),label);
 assert.ok(b.items.some(i=>/somewhat above your 3\+/.test(i.label)),label);
 }
 assert.equal(requiredOtherStack('Strong knowledge of Angular and Node.js. Experience with .NET is a plus.'),null);
 assert.equal(requiredOtherStack('Extensive knowledge in C#, Net Core technologies'),'.NET');
});

test('salary ranges are judged by their top end',async()=>{
 const {scoreBreakdown}=await import('../src/pipeline/deterministic-scoring.js');
 const label=(salaryText: string)=>scoreBreakdown({...job,salaryText}).items.find(i=>/Salary/.test(i.label))?.points;
 assert.equal(label('8-14 LPA'),5);
 assert.equal(label('12- 24 LPA'),5);
 assert.equal(label('3-6 LPA'),-8);
 assert.equal(label('15 LPA'),5);
});

test('Angular .NET remains visible at a lower capped score',()=>{
 assert.ok(deterministicScore({...job,roleTitle:'Frontend-Focused Full Stack Developer - Angular / .NET'})<=60);
 assert.equal(preSemanticSkipReason({...job,roleTitle:'Frontend-Focused Full Stack Developer - Angular / .NET'},60),null);
});

test('experience requirements are stored as readable text',()=>{
 assert.equal(experienceText({min:3,max:5}),'3–5 years');
 assert.equal(experienceText({min:4,max:99}),'4+ years');
 assert.equal(experienceText(null),null);
});

test('low-score Angular roles remain visible while absent Angular is skipped',()=>{
 const noAngular={...job,jobDescription:description.replace(/Angular/g,'Vue')};
 assert.equal(preSemanticSkipReason(noAngular,deterministicScore(noAngular)),'NO_ANGULAR_RELEVANCE');
 const weak={roleTitle:'Engineer',jobDescription:'Angular is occasionally used. '.repeat(5),normalizedLocation:'OTHER_INDIA'};
 assert.equal(preSemanticSkipReason(weak,deterministicScore(weak)),null);
 assert.equal(preSemanticSkipReason(job,deterministicScore(job)),null);
 assert.equal(blendScore(90,70),82);
});

test('non-target stacks, seniority and fresher signals lower the deterministic score',()=>{
 const base=deterministicScore(job);
 assert.ok(deterministicScore({...job,jobDescription:description+' React React.js React hooks React Native'})<base);
 assert.ok(deterministicScore({...job,roleTitle:'Staff Software Engineer'})<base);
 assert.ok(deterministicScore({...job,roleTitle:'Java Software Engineer'})<base);
 assert.ok(deterministicScore({...job,jobDescription:description+' Freshers welcome.'})<base);
 assert.ok(deterministicScore({...job,jobDescription:description.replace('3-5','6-8')})<base);
});

test('screening answers verified CV facts only',()=>{
 assert.deepEqual(classifyQuestion('Do you have experience with Angular?'),{question:'Do you have experience with Angular?',classification:'AUTO_ANSWER',answer:'Yes'});
 assert.equal(classifyQuestion('Have you worked with AWS?').answer,'Yes');
 assert.equal(classifyQuestion('Do you have experience with NgRx?').classification,'AUTO_ANSWER');
 assert.equal(classifyQuestion('How many years of Angular experience do you have?').classification,'ASK_USER');
 assert.equal(classifyQuestion('What is your highest qualification?').answer,'MCA');
 assert.equal(classifyQuestion('What is your date of birth?').classification,'DO_NOT_ANSWER');
 assert.equal(classifyQuestion('What is your expected CTC?').classification,'ASK_USER');
});

test('an exact source listing is preferred over a similar duplicate candidate',()=>{
 const listing={id:'b',applyUrl:'https://jobs.example.com/b',jobDescription:description,companyName:'Acme',contentHash:'h1',normalizedFingerprint:'acme|angular developer|kochi'};
 const similar={...listing,id:'a',applyUrl:'https://jobs.example.com/a',jobDescription:description+' Apply today',contentHash:'h2'};
 assert.equal(pickExisting([similar,listing],listing)?.id,'b');
 assert.equal(pickExisting([similar],listing)?.id,'a');
 assert.equal(pickExisting([{...similar,jobDescription:'Unrelated backend role in Go'}],listing),undefined);
 assert.equal(pickExisting([{...similar,normalizedFingerprint:'acme|java developer|kochi'}],listing),undefined,'a similar description under another title is not enough');
});

test('the same company reposting an identical description under another title is a duplicate',()=>{
 const listing={id:'b',applyUrl:'https://technopark.in/job-details/2',jobDescription:description,companyName:'REIZEND (P) Ltd',contentHash:'same',normalizedFingerprint:'reizend|senior full stack developer remote|trivandrum'};
 const repost={...listing,id:'a',applyUrl:'https://technopark.in/job-details/1',normalizedFingerprint:'reizend|3-6 yrs exp senior full stack developer|trivandrum'};
 assert.equal(pickExisting([repost],listing)?.id,'a');
 assert.equal(pickExisting([{...repost,companyName:'Another Company'}],listing),undefined);
});

test('source health reflects the latest fetch and counts consecutive failures',()=>{
 const at=(m:number)=>new Date(Date.UTC(2026,8,13,m));
 const health=sourceHealth([
 {eventType:'SOURCE_FAILURE',message:'Source HTTP 404',createdAt:at(3),metadata:{source:'lever',slug:'acme'}},
 {eventType:'SOURCE_FETCHED',message:'ok',createdAt:at(3),metadata:{source:'greenhouse',slug:'gitlab',listings:227}},
 {eventType:'SOURCE_FAILURE',message:'Source HTTP 500',createdAt:at(2),metadata:{source:'lever',slug:'acme'}},
 {eventType:'SOURCE_FETCHED',message:'ok',createdAt:at(1),metadata:{source:'lever',slug:'acme',listings:4}},
 {eventType:'SOURCE_FAILURE',message:'Source HTTP 500',createdAt:at(0),metadata:{source:'lever',slug:'acme'}}
 ]);
 assert.deepEqual(health.map(h=>[h.slug,h.healthy,h.consecutiveFailures,h.lastListings,h.lastError]),[['acme',false,2,4,'Source HTTP 404'],['gitlab',true,0,227,null]]);
});

test('static dashboard paths stay inside the bundle directory on every platform',()=>{
 const root=resolve('dashboard/dist');
 assert.equal(resolveStaticPath(root,'/main.js'),root+sep+'main.js');
 assert.equal(resolveStaticPath(root,'/'),resolve(root,'index.html'));
 assert.equal(resolveStaticPath(root,'/../package.json'),resolve(root,'index.html'));
 assert.equal(resolveStaticPath(root,'/%2e%2e/%2e%2e/.env'),resolve(root,'index.html'));
 assert.equal(resolveStaticPath(root,'/%E0%A4%A'),resolve(root,'index.html'));
});
