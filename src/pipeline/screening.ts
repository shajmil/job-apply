import { candidateProfile } from '../config/candidate-profile.js';
export const screeningPromptVersion='screen-v3';
export interface ScreeningAnswer {question:string;classification:'AUTO_ANSWER'|'ASK_USER'|'DO_NOT_ANSWER';answer?:string}
const key=(s:string)=>s.toLowerCase().replace(/\bapis?\b|\bworkspace\b|\bes6\+?|\.js\b/g,'').replace(/[^a-z0-9]/g,'');
// Short names a recruiter may use for a CV-listed skill. Every target must be a verified skill name.
const aliases: Record<string,string[]>={angular:['Angular 18','Angular 21'],node:['Node.js'],nodejs:['Node.js'],express:['Express.js'],expressjs:['Express.js'],rest:['REST APIs'],aws:['AWS S3','AWS RDS','AWS EC2','AWS SNS','AWS SES'],git:['Git/GitHub'],github:['Git/GitHub'],nx:['Nx Workspace'],signals:['Angular Signals'],cicd:['CI/CD'],tailwindcss:['Tailwind'],mongo:['MongoDB'],socketio:['Socket.io']};
export function verifiedSkillsFor(name:string): string[] {
 const k=key(name), names=candidateProfile.verifiedSkills.map(s=>s.name);
 const direct=names.filter(n=>key(n)===k);
 return direct.length?direct:(aliases[k]??[]).filter(n=>names.includes(n));
}
export function classifyQuestion(question:string): ScreeningAnswer {
 const q=question.trim();
 if(/passport|religion|caste|health|bank|national id|aadhaar|\bpan\b|sexual|race|gender|marital|disabilit|date of birth|\bage\b/i.test(q)) return {question,classification:'DO_NOT_ANSWER'};
 if(/salary|ctc|compensation|notice|available|relocat|visa|authori[sz]ation|willing|current|sponsor|expected/i.test(q)) return {question,classification:'ASK_USER'};
 if(/^what is your (full )?name\??$/i.test(q)) return {question,classification:'AUTO_ANSWER',answer:candidateProfile.fullName};
 if(/^how many years of (professional )?(software[- ]development )?experience do you have\??$/i.test(q)) return {question,classification:'AUTO_ANSWER',answer:`${candidateProfile.professionalExperienceYears}+ years`};
 if(/^what is your (email|e-mail)( address)?\??$/i.test(q)) {
 const email=process.env.APPLICANT_EMAIL_ADDRESS;
 return email?{question,classification:'AUTO_ANSWER',answer:email}:{question,classification:'ASK_USER'};
 }
 if(/^what is your highest (qualification|degree|level of education)\??$/i.test(q)&&candidateProfile.education.includes('MCA')) return {question,classification:'AUTO_ANSWER',answer:'MCA'};
 if(/^what (is your (qualification|degree|education)|degrees? do you (hold|have))\??$/i.test(q)) return {question,classification:'AUTO_ANSWER',answer:candidateProfile.education.join(' and ')};
 // Yes/no experience with a named technology is answerable only when the CV lists it.
 const skill=q.match(/^(?:do|have) you (?:have )?(?:any )?(?:professional |hands-on |working )?(?:experience|worked) (?:with|in|using|on) (.{1,60}?)\??$/i)?.[1];
 if(skill&&verifiedSkillsFor(skill).length) return {question,classification:'AUTO_ANSWER',answer:'Yes'};
 // Per-technology durations are not recorded in the CV; the candidate can supply them for listed skills.
 const years=q.match(/^how many years of (?:professional |hands-on )?(.{1,60}?) experience/i)?.[1];
 if(years&&verifiedSkillsFor(years).length) return {question,classification:'ASK_USER'};
 return {question,classification:'DO_NOT_ANSWER'};
}
