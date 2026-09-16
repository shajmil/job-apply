import { importedBoardSources } from './job-board-import.js';
import type { JobSource } from './job-source.js';
import { createSource as createAtsSource } from './ats-sources.js';
import { createInfoparkSource, createTechnoparkSource } from './kerala-parks.js';
import { careerPageSources, createCareerPageSource, createCutshortSource, createHiristSource } from './structured-pages.js';
export const MANUAL_SOURCE='manual';
// Rebuilds a source from a stored listing's identity, for re-verification before sending.
export function createSource(sourceName: string, sourceSlug: string): JobSource {
 switch(sourceName) {
 case 'lever': case 'greenhouse': return createAtsSource(sourceName,sourceSlug);
 case 'infopark': return createInfoparkSource();
 case 'technopark': return createTechnoparkSource();
 case 'cutshort': return createCutshortSource();
 case 'hirist': return createHiristSource();
 case 'career': return createCareerPageSource(sourceSlug,[]);
 case 'linkedin': case 'naukri': case MANUAL_SOURCE: throw new Error('Manually added listings cannot be re-verified automatically; apply through the original listing');
 default: throw new Error(`Unknown job source ${sourceName}`);
 }
}
const enabled=(name: string, fallback=true)=>{ const v=process.env[name]; return v===undefined?fallback:v==='true'; };
const slugs=(value: string)=>value.split(',').map(s=>s.trim()).filter(Boolean);
export function configuredSources(): JobSource[] {
 const sources: JobSource[]=[
 ...slugs(process.env.GREENHOUSE_COMPANIES??'particle41llc,encora10,envoyglobalinc,capco,tide').map(s=>createAtsSource('greenhouse',s)),
 ...slugs(process.env.LEVER_COMPANIES??'smart-working-solutions').map(s=>createAtsSource('lever',s))
 ];
 if(enabled('INFOPARK_ENABLED')) sources.push(createInfoparkSource());
 if(enabled('TECHNOPARK_ENABLED')) sources.push(createTechnoparkSource());
 if((process.env.CUTSHORT_KEYWORDS??'angular').trim()) sources.push(createCutshortSource());
 if((process.env.HIRIST_KEYWORDS??'angular').trim()) sources.push(createHiristSource());
 return [...sources,...careerPageSources(),...importedBoardSources()];
}
