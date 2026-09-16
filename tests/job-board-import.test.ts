import {test} from 'node:test';
import assert from 'node:assert/strict';
import {jobBoard,parseBoardImport} from '../src/sources/job-board-import.js';
import {manualListing} from '../src/pipeline/manual-import.js';
import {createSource} from '../src/sources/registry.js';
const row={applyUrl:'https://www.linkedin.com/jobs/view/123?utm_source=alert',companyName:'Example',roleTitle:'Software Engineer',locationText:'Kochi',jobDescription:'Build Angular and Node.js applications. TypeScript, REST APIs and unit testing are required. Experience: 2–4 years.'};
test('LinkedIn and Naukri imports retain the platform and normalize duplicate identities',()=>{
 const [a]=parseBoardImport([row]);assert.equal(a.sourceName,'linkedin');
 assert.equal(a.sourceJobId,parseBoardImport([{...row,applyUrl:'https://www.linkedin.com/jobs/view/123'}])[0].sourceJobId);
 assert.equal(manualListing({...row,applyUrl:'https://www.naukri.com/job-listings-example-123'}).sourceName,'naukri');
});
test('import rejects lookalike domains, incomplete descriptions and oversized batches before writes',()=>{
 assert.equal(jobBoard('https://linkedin.com.attacker.test/jobs/1'),null);
 assert.throws(()=>parseBoardImport([{...row,applyUrl:'https://example.com/jobs/1'}]));
 assert.throws(()=>parseBoardImport([{...row,jobDescription:'Only a teaser'}]));
 assert.throws(()=>parseBoardImport(Array(101).fill(row)));
});
test('imported job boards cannot be treated as automatically reverified sources',()=>{
 assert.throws(()=>createSource('linkedin','user-import'),/cannot be re-verified/);
 assert.throws(()=>createSource('naukri','user-import'),/cannot be re-verified/);
});
