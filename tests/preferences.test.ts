import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {candidateProfile} from '../src/config/candidate-profile.js';
import {hardFilter,reviewPolicy,preSemanticSkipReason,deterministicScore,requiredOtherStack} from '../src/pipeline/deterministic-scoring.js';
const job=(description:string,roleTitle='Software Engineer')=>({roleTitle,jobDescription:description,normalizedLocation:'KOCHI',jobActive:true});
const angular='Build and maintain Angular applications with TypeScript, HTML, CSS, RxJS, NgRx, Vitest, GitHub Actions and REST APIs. Required experience: 2–4 years.';
test('the supplied Techversant role remains visible with truthful required-skill gaps',()=>{
 const j=job(readFileSync(new URL('./fixtures/techversant-web-developer.txt',import.meta.url),'utf8'),'Web Developer');
 assert.equal(hardFilter(j),null);
 assert.equal(preSemanticSkipReason(j,deterministicScore(j)),null);
 const policy=reviewPolicy(j);assert.equal(policy.visible,true);assert.equal(policy.priority,'LOW');
 assert.ok(policy.flags.includes('REQUIRED_PHP_NOT_ON_CV'));
 assert.ok(policy.flags.includes('AI_ASSISTANT_EXPERIENCE_NOT_VERIFIED'));
});
test('Angular plus Node is preferred, Angular alone shown, Angular .NET lower, required Java skipped',()=>{
 assert.equal(reviewPolicy(job(angular+' Develop backend APIs using Node.js and Express.js.')).priority,'HIGH');
 assert.equal(reviewPolicy(job(angular)).visible,true);
 const dotnet=job(angular+' Strong proficiency in .NET and C# is required.');
 assert.equal(reviewPolicy(dotnet).visible,true);assert.equal(reviewPolicy(dotnet).priority,'LOW');
 assert.ok(deterministicScore(dotnet)<=60);
 assert.equal(hardFilter(job(angular+' Strong proficiency in Java and Spring Boot.')),'JAVA_PRIMARY');
 assert.equal(hardFilter(job(angular,'Full Stack Developer Java + Angular')),'JAVA_PRIMARY');
});
test('technology alternatives are not interpreted as requiring every listed language',()=>{
 const j=job('2–4 years experience. Required skills: strong proficiency in any of Angular, React, Java or Node.js. Build responsive web applications and REST APIs.');
 assert.equal(hardFilter(j),null);assert.equal(reviewPolicy(j).visible,true);
 assert.equal(requiredOtherStack('Strong proficiency in either Node.js or Java for APIs. Angular frontend experience.'),null);
});
test('generic titles use JD and company catalogue Java does not disqualify Angular',()=>{
 for(const title of ['Frontend Developer','Software Engineer','Web Developer']) {
 assert.equal(reviewPolicy(job('About us: We offer Java, .NET, PHP and Angular services. Responsibilities: '+angular,title)).visible,true);
 }
});
test('four-year requirement is a preference, never a fabricated experience claim',()=>{
 assert.equal(candidateProfile.professionalExperienceYears,3);
 assert.equal(hardFilter(job(angular.replace('2–4','4–5'))),null);
 assert.equal(hardFilter(job(angular.replace('2–4','5–7'))),'EXPERIENCE_TOO_HIGH');
 assert.equal(hardFilter(job(angular.replace('2–4 years','5+ years'))),'EXPERIENCE_TOO_HIGH');
});
test('new PDF evidence verifies formerly excluded skills without adding PHP, Java, .NET or AI assistants',()=>{
 for(const name of ['RxJS','NgRx','Standalone Components','Reactive Forms','AG Grid','Vitest','Angular TestBed','GitHub Actions']) assert.ok(candidateProfile.verifiedSkills.some(s=>s.name===name&&s.evidence.includes(name)),name);
 for(const name of ['PHP','Python','Java','.NET','GitHub Copilot']) assert.ok(!candidateProfile.verifiedSkills.some(s=>s.name===name));
});
