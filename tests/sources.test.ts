import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowed, parseRobots } from '../src/sources/http.js';
import { htmlToText, jsonLdJobPostings, listingFromJobPosting, registrableDomain } from '../src/sources/html.js';
import { parseInfoparkDetail, parseInfoparkList, parseTechnoparkDetail, listingFromTechnopark } from '../src/sources/kerala-parks.js';
import { jobLinks, listingFromHirist, parseSitemap, selectEntries } from '../src/sources/structured-pages.js';
import { isTechRole } from '../src/sources/relevance.js';
import { normalizeListing, extractApplicationEmail } from '../src/pipeline/normalization.js';
import { recipientMatchesCompany, validateRecipient } from '../src/safety/application-guards.js';
import { manualListing, validateManualJob } from '../src/pipeline/manual-import.js';
import { createSource } from '../src/sources/registry.js';

test('robots.txt rules are honoured, including wildcards, crawl delay and blanket bans',()=>{
 const cutshort=parseRobots('User-agent: * \nDisallow: /view/j/ \nDisallow: /*?job_listing \nSitemap: https://cutshort.io/sitemap_jobs.xml');
 assert.equal(isAllowed(cutshort,'/job/Frontend-angular-Developer-wR9w8zKx'),true);
 assert.equal(isAllowed(cutshort,'/view/j/abc'),false);
 assert.equal(isAllowed(cutshort,'/jobs?job_listing=1'),false);
 const hirist=parseRobots('User-agent: *\nDisallow: /admin/\nUser-agent: Yandex\nDisallow: /\n\nCrawl-delay: 10');
 assert.equal(isAllowed(hirist,'/j/some-job-1669450'),true);
 const linkedin=parseRobots('User-agent: LinkedInBot\nAllow: /\n\nUser-agent: *\nDisallow: /');
 assert.equal(isAllowed(linkedin,'/jobs/view/123'),false);
 const allowOverride=parseRobots('User-agent: *\nDisallow: /jobs\nAllow: /jobs/public');
 assert.equal(isAllowed(allowOverride,'/jobs/public/1'),true);
 assert.equal(parseRobots('User-agent: *\nCrawl-delay: 10\nDisallow: /x').crawlDelaySeconds,10);
});

test('JobPosting data becomes a listing with salary, experience and expiry handling',()=>{
 const html=`<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage"}</script>
 <script type="application/ld+json">{"@context":"http://schema.org/","@type":"JobPosting","title":"Frontend angular Developer","description":"Frontend developer with Angular<br />Angular8+, TypeScript","identifier":{"@type":"PropertyValue","value":"634ff675"},"validThrough":"2099-12-12T10:54:59Z","experienceRequirements":{"monthsOfExperience":36},"hiringOrganization":{"@type":"Organization","name":"Make Visions Outsourcing Pvt Ltd","sameAs":["https://cutshort.io/company/make-visions"]},"jobLocation":{"@type":"Place","address":{"addressLocality":"Gurugram","addressCountry":"IN"}},"baseSalary":{"currency":"INR","value":{"minValue":500000,"maxValue":700000,"unitText":"YEAR"}}}</script>`;
 const [posting]=jsonLdJobPostings(html);
 const listing=listingFromJobPosting(posting,{sourceName:'cutshort',sourceSlug:'india',pageUrl:'https://cutshort.io/job/Frontend-angular-Developer-wR9w8zKx'})!;
 assert.equal(listing.sourceJobId,'634ff675');
 assert.equal(listing.locationText,'Gurugram, India');
 assert.equal(listing.salaryText,'5-7 LPA');
 assert.match(listing.jobDescription,/3\+ years experience/);
 assert.equal(listing.companyDomain,undefined,'job-board profile links never vouch for an employer domain');
 assert.equal(listingFromJobPosting({...posting,validThrough:'2020-01-01T00:00:00Z'},{sourceName:'cutshort',sourceSlug:'india',pageUrl:'https://cutshort.io/job/x'}),null);
 const graph=jsonLdJobPostings('<script type="application/ld+json">{"@graph":[{"@type":"Organization"},{"@type":["JobPosting"],"title":"UI Engineer"}]}</script>');
 assert.equal(graph.length,1);
 assert.equal(htmlToText('<p>Skills:</p><ul><li>Angular</li><li>Node &amp; Express</li></ul>'),'Skills:\n- Angular\n- Node & Express');
});

test('Infopark listing tables and detail pages are parsed',()=>{
 const list=`<table><tbody><tr>
 <td class="head">11-09-2026</td><td class="head">FullStack Developer (PHP,Node.Js)</td><td class="date">NDimensionZ Solutions Pvt.Ltd.</td><td>30 Sep 2026</td>
 <td class="btn-sec"><a href="https://infopark.in/company-jobs/details/209/25441"><button>Details</button></a></td></tr></tbody></table>
 <ul class="pagination"><li><a class="page-link" href="https://infopark.in/companies-job/infopark-kochi-phase-1?page=2">2</a></li></ul>`;
 const {rows,hasNext}=parseInfoparkList(list);
 assert.deepEqual(rows.map(r=>[r.jobId,r.companyId,r.title,r.company,r.lastDate]),[['25441','209','FullStack Developer (PHP,Node.Js)','NDimensionZ Solutions Pvt.Ltd.','30 Sep 2026']]);
 assert.equal(hasNext(1),true); assert.equal(hasNext(2),false);
 const detail=`<div class="con"><h4>NDimensionZ Solutions Pvt.Ltd.</h4><span>hr@ndimensionz.com</span></div>
 <div class="comp-job-deatiil"><div class="deatil-box"><h4>FullStack Developer (PHP,Node.Js,Express.Js)</h4>Experience: 5+ Years<br />Good working knowledge of Node.js and Express.js.<br />
 <div class="contact"><p>Share your resume at <b><a href="mailto:athira.r@ndimensionz.com">athira.r@ndimensionz.com</a></b></p></div></div></div>`;
 const parsed=parseInfoparkDetail(detail)!;
 assert.equal(parsed.company,'NDimensionZ Solutions Pvt.Ltd.');
 assert.equal(parsed.title,'FullStack Developer (PHP,Node.Js,Express.Js)');
 assert.match(parsed.description,/Experience: 5\+ Years\nGood working knowledge/);
 assert.match(parsed.description,/athira\.r@ndimensionz\.com/);
});

test('Technopark page data yields a listing whose careers mailbox matches the published company website',()=>{
 const job={id:32856,job_title:'Full Stack Developer',contact_email:'careers@shellsquare.com',status:'APPROVED',deleted_at:null,closing_date:'2099-09-30',posted_date:'2026-09-11',
 job_description:'<p><strong>Experience: 2-4 Year</strong><br><strong>Location: Trivandrum - Work from office</strong></p><ul><li>Frontend: Angular, TypeScript</li></ul>',
 preferred_skills:'<ul><li>Docker</li></ul>',company:{company:'ShellSquare Softwares (P) Ltd',website:'http://www.shellsquare.com'}};
 const attr=JSON.stringify({component:'JobListing/JobDetailPage',props:{jobListing:job}}).replace(/&/g,'&amp;').replace(/"/g,'&quot;');
 assert.deepEqual(parseTechnoparkDetail(`<div id="app" data-page="${attr}"></div>`),job);
 const listing=listingFromTechnopark(job,'trivandrum')!;
 assert.equal(listing.companyDomain,'shellsquare.com');
 assert.equal(listing.locationText,'Trivandrum - Work from office (Technopark, Thiruvananthapuram, Kerala, India)');
 const normalized=normalizeListing(listing);
 assert.equal(normalized.normalizedLocation,'TRIVANDRUM');
 const email=extractApplicationEmail(normalized.jobDescription)!;
 assert.equal(email,'careers@shellsquare.com');
 assert.equal(validateRecipient(email,normalized.jobDescription)&&recipientMatchesCompany(email,listing.companyName,listing.companyDomain),true);
 assert.equal(listingFromTechnopark({...job,closing_date:'2020-01-01'},'trivandrum'),null);
});

test('Hirist job data and sitemaps are read, newest matching jobs first',()=>{
 const listing=listingFromHirist({id:1669450,title:'Senior Full Stack Developer - AngularJS/Node.js',introText:'<p>Build web apps</p>',min:3,max:6,status:1,workFromHome:1,
 locations:[{name:'Kochi'}],tags:[{name:'AngularJS'},{name:'Node.js'}],companyData:{companyName:'Sciative'},jobDetailUrl:'https://www.hirist.tech/j/x-1669450'},'https://www.hirist.tech/j/x-1669450')!;
 assert.equal(listing.locationText,'Remote, Kochi');
 assert.match(listing.jobDescription,/^Experience: 3-6 years/);
 assert.equal(listingFromHirist({id:1,title:'x',introText:'y',status:0},'https://www.hirist.tech/j/x'),null);
 const {entries,children}=parseSitemap('<urlset><url><loc>https://www.hirist.tech/j/java-dev-1</loc><lastmod>2026-09-10T00:00:00Z</lastmod></url><url><loc>https://www.hirist.tech/j/angular-dev-2</loc><lastmod>2026-09-01T00:00:00Z</lastmod></url><url><loc>https://www.hirist.tech/j/senior-angular-lead-3</loc><lastmod>2026-09-12T00:00:00Z</lastmod></url></urlset>');
 assert.equal(children.length,0);
 assert.deepEqual(selectEntries(entries,['angular'],5).map(e=>e.loc.split('/').pop()),['senior-angular-lead-3','angular-dev-2']);
 assert.deepEqual(parseSitemap('<sitemapindex><sitemap><loc>https://www.hirist.tech/new_sitemap-j-1.xml.gz</loc></sitemap></sitemapindex>').children,['https://www.hirist.tech/new_sitemap-j-1.xml.gz']);
});

test('career pages follow only same-site job links',()=>{
 const html='<a href="/careers/angular-developer">A</a><a href="https://other.com/jobs/1">B</a><a href="/about">C</a><a href="/jobs/42#apply">D</a>';
 assert.deepEqual(jobLinks(html,'https://acme.example/careers',10),['https://acme.example/careers/angular-developer','https://acme.example/jobs/42']);
});

test('park titles are prefiltered broadly for software roles',()=>{
 for(const t of ['Angular Developer','Senior Software Engineer','Full Stack Developer','UI/UX Designer','Technical Lead - Web']) assert.equal(isTechRole(t),true,t);
 for(const t of ['Business Development Executive','HR Operations & Executive Assistant','Accountant']) assert.equal(isTechRole(t),false,t);
});

test('recipient domains must belong to the employer',()=>{
 assert.equal(registrableDomain('careers.acme.co.in'),'acme.co.in');
 assert.equal(recipientMatchesCompany('careers@shellsquare.com','ShellSquare Softwares (P) Ltd'),true);
 assert.equal(recipientMatchesCompany('careers@shell.com','ShellSquare Softwares (P) Ltd'),false);
 assert.equal(recipientMatchesCompany('careers@mail.acme.com','Other Name Ltd','www.acme.com'),true);
 assert.equal(recipientMatchesCompany('careers@acme-jobs.com','Acme','acme.com'),false);
 assert.equal(recipientMatchesCompany('careers@example-attacker.com','example'),false);
});

test('manually added jobs are validated and can never be re-verified for automatic sending',()=>{
 assert.throws(()=>validateManualJob({applyUrl:'http://www.linkedin.com/jobs/view/1',companyName:'Acme',roleTitle:'Angular Developer',jobDescription:'x'.repeat(120)}),/https/);
 assert.throws(()=>validateManualJob({applyUrl:'https://www.linkedin.com/jobs/view/1',companyName:'Acme',roleTitle:'Angular Developer',jobDescription:'too short'}),/jobDescription/);
 const input=validateManualJob({applyUrl:'https://www.linkedin.com/jobs/view/1?utm_source=alert',companyName:'Acme',roleTitle:'Angular Developer',locationText:'Kochi',jobDescription:'Angular '.repeat(20)});
 const a=manualListing(input), b=manualListing({...input,applyUrl:'https://www.linkedin.com/jobs/view/1'});
 assert.equal(a.sourceJobId,b.sourceJobId);
 assert.equal(a.sourceSlug,'linkedin-com');
 assert.throws(()=>createSource('manual',a.sourceSlug),/cannot be re-verified/);
});
