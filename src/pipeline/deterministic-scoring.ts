import { candidateProfile } from '../config/candidate-profile.js';
import { experienceRange } from './normalization.js';
export const QUALIFY_THRESHOLD=75, DETERMINISTIC_WEIGHT=.6, SEMANTIC_WEIGHT=.4;
export interface Scorable {roleTitle:string;jobDescription:string;normalizedLocation:string|null;salaryText?:string|null;jobActive?:boolean}
export type AngularRelevance='strong'|'weak'|'none';
export interface ScoreItem { label: string; points: number }
export interface ScoreBreakdown { total: number; relevance: AngularRelevance; items: ScoreItem[] }
const angular=/\bangular\b/;
const count=(text:string, re:RegExp)=>text.match(new RegExp(re.source,'g'))?.length??0;
// Title words naming a primary stack or discipline other than Angular front-end or full-stack work.
const otherStackTitle=/python|django|\bjava\b|spring|\.net|c#|\bphp\b|laravel|golang|\bgo developer|ruby|rails|flutter|android|\bios\b|react native|salesforce|\bsap\b|data (?:engineer|scientist|analyst)|devops|\bsre\b|\bqa\b|tester|testing|automation|nest\.?\s?js|back.?end|mainframe|embedded|network|support engineer|security engineer|ai engineer|ml engineer|machine learning|databricks/;
const targetTitle=/angular|front.?end|full.?stack|\bui\b|web developer|\bmean\b/;
// "Full Stack Developer - .NET" is still a .NET role; only an Angular or front-end title outweighs another stack.
const outweighsOtherStack=/angular|front.?end|\bui\b|\bmean\b/;
const stackFamilies: Array<[string, RegExp]>=[['Java/Spring',/^(?:java|j2ee|spring boot|spring)$/],['.NET',/^(?:\.net|asp\.net|c#)$/],['Python',/^(?:python|django)$/],['PHP',/^(?:php|laravel)$/],['Go',/^golang$/],['Ruby',/^ruby on rails$/]];
// Company introductions describe the employer's offerings, not the job's requirements.
export function roleRequirements(description: string): string {
 const marker=/\b(?:we are looking|we are seeking|the ideal candidate|responsibilities|job responsibilities|job description|experience & qualifications|required skills|requirements|key responsibilities)\b/i.exec(description);
 return marker?description.slice(marker.index):description.replace(/(?:our company|we|techversant)\s+(?:offers?|works? with|provides?|speciali[sz]es?)[^.\n]*(?:\.(?!net)|$)/gi,'');
}
const java=/\b(?:java(?!script)|j2ee|spring(?: boot| mvc| security)?)\b/i;
const dotnet=/(?:\.net|asp\.net|c#|net core)/i;
const optional=/\b(?:optional|nice to have|a plus|bonus|preferred|exposure|familiarity|working knowledge)\b/i;
export function requiredOtherStack(text: string): string | null {
 const role=roleRequirements(text).toLowerCase();
 const required=/\b(?:strong|solid|deep|expert|expertise|proficien\w*|hands-on|handson|extensive|advanced|excellent|must have|mandatory|required|develop|build|maintain|write|implement|code)\b[^\n;]{0,110}?(\b(?:java(?!script)|j2ee|spring boot|python|django|php|laravel|golang|ruby on rails)\b|asp\.net|\.net|c#)/g;
 for(const sentence of role.split(/(?<=[.!?])\s+|[\n;]/)) {
 if(/one of|any of|either|\bor\b|\//i.test(sentence)&&/angular|node(?:[ .]?js)?/i.test(sentence)) continue;
 if(optional.test(sentence)) continue;
 for(const m of sentence.matchAll(required)) {
 const family=stackFamilies.find(([,re])=>re.test(m[1]))?.[0];
 if(family)return family;
 }
 }
 return null;
}
export function requiresJava(j: Pick<Scorable,'roleTitle'|'jobDescription'>): boolean {
 if(java.test(j.roleTitle)&&!/one of|any of|\bor\b/i.test(j.roleTitle)) return true;
 return requiredOtherStack(roleRequirements(j.jobDescription).replace(/\b(?:python|django|php|laravel|golang|ruby on rails)\b|asp\.net|\.net|c#/gi,''))==='Java/Spring';
}
export type MatchPriority='HIGH'|'NORMAL'|'LOW';
export function reviewPolicy(j: Scorable): {visible:boolean;priority:MatchPriority;flags:string[]} {
 const relevance=angularRelevance(j.roleTitle,j.jobDescription), role=roleRequirements(j.jobDescription);
 const required=requiredOtherStack(j.jobDescription);
 const flags:string[]=[];
 if(relevance==='weak')flags.push('ANGULAR_OPTIONAL_OR_COMPANY_CONTEXT');
 if(required) flags.push('REQUIRED_'+required.toUpperCase().replace(/[^A-Z]+/g,'_')+'_NOT_ON_CV');
 if(/(?:mandatory|required|proven experience)[^.]*AI (?:coding |tools|assist)|AI coding assistants/i.test(role))flags.push('AI_ASSISTANT_EXPERIENCE_NOT_VERIFIED');
 const low=relevance==='weak'||!!required||dotnet.test(j.roleTitle);
 const node=/\bnode(?:[ .]?js)?\b/i.test(role);
 return {visible:relevance!=='none'&&!hardFilter(j),priority:low?'LOW':node?'HIGH':'NORMAL',flags};
}
export function shouldShowForReview(j: Scorable): boolean {return reviewPolicy(j).visible;}
export function hardFilter(j: Scorable): string|null {
 const title=j.roleTitle.toLowerCase(), all=`${title} ${j.jobDescription}`.toLowerCase();
 if(j.jobActive===false) return 'JOB_CLOSED';
 if(/\b(intern|internship|trainee)\b/.test(title)) return 'INTERNSHIP';
 if(/\bfresher/.test(title)) return 'FRESHER';
 if(j.normalizedLocation==='OUTSIDE_INDIA') return 'LOCATION_MISMATCH';
 const exp=experienceRange(j.jobDescription); if(exp&&exp.min>candidateProfile.maximumRequiredExperienceYears) return 'EXPERIENCE_TOO_HIGH';
 if(exp&&exp.max<2) return 'EXPERIENCE_TOO_LOW';
 if(requiresJava(j)) return 'JAVA_PRIMARY';
 if(!angular.test(all)) {
 for(const [pattern,reason] of [[/\breact\b/,'REACT_PRIMARY'],[/\bjava\b|spring boot/,'JAVA_PRIMARY'],[/\.net|c#/,'DOTNET_PRIMARY'],[/\bphp\b/,'PHP_PRIMARY']] as const) if(pattern.test(title)) return reason;
 }
 if(j.jobDescription.length<100) return 'INSUFFICIENT_INFORMATION';
 return null;
}
// Strong: Angular is in the title, stated as a firm requirement, or named in the role's technology stack.
// Weak: Angular appears only as context ("serve the Angular portal", "familiarity with Angular", company tech lists).
export function angularRelevance(roleTitle: string, description: string): AngularRelevance {
 const title=roleTitle.toLowerCase(), text=description.toLowerCase();
 if(angular.test(title)) return 'strong';
 if(!angular.test(text)) return /\bangularjs\b/.test(`${title} ${text}`)?'weak':'none';
 const firmRequirement=/\b(?:strong|solid|deep|expert|expertise|proficien\w*|hands-on|handson|extensive|proven|advanced|excellent|must have|mandatory|required)\b[^.\n]{0,60}\bangular\b/;
 const inStack=/\b(?:tech(?:nology)? stack|primary skills?|key skills?|skills required|mandatory skills?|frontend|front-end)\s*:[^.\n]{0,80}\bangular\b/;
 const asRole=/\bangular\s+(?:developer|engineer|expert|lead|development experience)\b/;
 // Hands-on work on Angular itself: "Build Angular frontend applications", "develop scalable Angular apps".
 const handsOn=/\b(?:build|develop|design|implement|create)(?:s|ing|ed)?\s+(?:[a-z-]+\s+){0,3}angular\b/;
 return firmRequirement.test(text)||inStack.test(text)||asRole.test(text)||handsOn.test(text)?'strong':'weak';
}
export function scoreBreakdown(j: Scorable): ScoreBreakdown {
 const title=j.roleTitle.toLowerCase(), t=`${title} ${roleRequirements(j.jobDescription)}`.toLowerCase();
 const items: ScoreItem[]=[], add=(label: string, points: number)=>{ if(points) items.push({label,points}); };
 const relevance=angularRelevance(j.roleTitle,j.jobDescription);
 add(relevance==='strong'?'Angular is central to the role':'Angular is mentioned only in passing',relevance==='strong'?32:relevance==='weak'?12:0);
 const factors: Array<[string,RegExp,number]>=[['RxJS',/\brxjs\b/,2],['NgRx',/\bngrx\b/,2],['Standalone Components',/standalone components/,1],['Reactive Forms',/reactive forms/,1],['Vitest',/vitest/,1],['Angular TestBed',/testbed/,1],['GitHub Actions',/github actions/,1],['HTML5',/\bhtml5?\b/,1],['CSS3',/\bcss3?\b/,1],['TypeScript',/typescript/,7],['JavaScript ES6+',/javascript/,3],['Node.js',/node(?:\.js|js|\b)/,7],['Express.js',/express/,3],['REST APIs',/\brest(?:ful)?\b/,3],['GraphQL',/graphql/,3],['Angular Signals',/signals/,2],['Nx Workspace',/\bnx\b/,2],['PrimeNG',/primeng/,2],['Angular Material',/angular material/,1],['Docker',/docker/,2],['CI/CD',/ci\/cd/,2],['AWS EC2',/\baws\b/,2],['MySQL',/mysql/,1],['MongoDB',/mongodb/,1],['Socket.io',/socket\.io/,1],['Tailwind',/tailwind/,1]];
 // Points are only possible for skills backed by CV evidence.
 for(const [skill,re,points] of factors) if(candidateProfile.verifiedSkills.some(s=>s.name===skill)&&re.test(t)) add(`Uses ${skill==='AWS EC2'?'AWS':skill} from your CV`,points);
 if(targetTitle.test(title)||/software (?:engineer|developer)/.test(title)) add('Preferred role title',5);
 const exp=experienceRange(j.jobDescription), years=candidateProfile.professionalExperienceYears;
 if(!exp) add('Experience not stated',4);
 else if(exp.min<=years&&exp.max>=years) add(`Asks for ${exp.max>=99?`${exp.min}+`:`${exp.min}–${exp.max}`} years, which fits`,8);
 const asked=exp?(exp.max>=99?`${exp.min}+`:`${exp.min}–${exp.max}`):'';
 if(exp&&exp.min>years+2) add(`Asks for ${asked} years, above your experience`,-8);
 else if(exp&&exp.min>years) add(`Asks for ${asked} years, somewhat above your ${years}+`,-4);
 if(exp&&exp.max<years) add('Aimed below your experience',-8);
 const locationPoints: Record<string,[string,number]>={REMOTE_INDIA:['Remote in India',16],KOCHI:['Kochi',14],TRIVANDRUM:['Trivandrum',12],UNKNOWN:['Location unclear',2],RELOCATION_REQUIRED:['Relocation required',-15],OUTSIDE_INDIA:['Outside India',-25]};
 const [place,placePoints]=locationPoints[j.normalizedLocation??'UNKNOWN']??['Elsewhere in India',0];
 add(`Location: ${place}`,placePoints);
 // A range counts as meeting the target when its top end does ("8-14 LPA" can reach 12 LPA).
 const salary=j.salaryText?.match(/(\d+(?:\.\d+)?)\s*(?:(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*)?(?:lpa|lakhs?)/i);
 const target=candidateProfile.targetAnnualSalaryLakhs, top=salary?Number(salary[2]??salary[1]):null;
 if(top!==null) add(top>=target?`Salary can reach ${target} LPA`:`Salary below ${target} LPA`,top>=target?5:-8);
 // Penalties for stacks that are not the target, even when Angular appears somewhere in the text.
 const alternatives=/angular\s*(?:\/|\bor\b|,)\s*react|react(?:\.?js)?\s*(?:\/|\bor\b|,)\s*angular/.test(t);
 if(!alternatives&&(/\breact\b/.test(title)&&!angular.test(title)||count(t,/\breact(?:\.?js)?\b/)>count(t,/\bangular\b/))) add('React is the main framework',-10);
 const other=title.match(otherStackTitle)?.[0];
 if(other&&!outweighsOtherStack.test(title)) add(`Title points to another stack (${other})`,-15);
 else {
 // A firm requirement for a back-end stack the CV does not list makes it a main skill of the job,
 // even in "Full Stack (Java + Angular)" roles where Angular is also required.
 const required=requiredOtherStack(t);
 if(required) add(`Requires ${required} as a main skill, which is not on your CV`,-12);
 }
 if(/\b(freshers?|entry[- ]level|graduate trainee)\b/.test(t)) add('Fresher or entry-level wording',-10);
 if(/\b(staff|principal|architect|director|head of|vice president|vp)\b/.test(title)) add('Staff, principal, architect or director title',-12);
 const lowDotnet=dotnet.test(title)||requiredOtherStack(j.jobDescription)==='.NET';
 const raw=items.reduce((s,i)=>s+i.points,0), cap=lowDotnet?60:relevance==='strong'?100:relevance==='weak'?70:45;
 if(raw>cap) add(lowDotnet?'Lower priority: .NET is required but not on your CV':`Capped at ${cap} because Angular is ${relevance==='weak'?'not central':'absent'}`,cap-raw);
 return {total:Math.max(0,Math.min(cap,raw)),relevance,items};
}
export const deterministicScore=(j: Scorable)=>scoreBreakdown(j).total;
// Visibility is independent of numerical score: every eligible Angular mention is reviewable.
export function preSemanticSkipReason(j: Scorable, _deterministic: number): string|null {
 return hardFilter(j)??(angularRelevance(j.roleTitle,j.jobDescription)==='none'?'NO_ANGULAR_RELEVANCE':null);
}
// Plain-language summary of the factors that held a skipped job back.
export function skipExplanation(b: ScoreBreakdown): string {
 return b.relevance==='none'?'No Angular relevance was found in the title or job description.':'An eligibility rule excludes this listing; the score alone does not hide Angular opportunities.';
}
export const blendScore=(deterministic:number, semantic:number)=>Math.round((deterministic*DETERMINISTIC_WEIGHT+semantic*SEMANTIC_WEIGHT)*10)/10;
