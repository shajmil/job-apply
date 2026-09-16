export interface VerifiedSkill { name: string; evidence: string; source: 'cv' }
export interface VerifiedHighlight { id: string; statement: string; evidence: string; source: 'cv' }
// Authoritative source: SHAJMIL VJ - Software Engineer.pdf, supplied by the user.
// Evidence below is transcribed from the PDF, not inferred from job descriptions.
const skillGroups: Array<[string, string[]]> = [
 ['Frontend: Angular 21, Angular 18, TypeScript, JavaScript (ES6+), HTML5, CSS3, SCSS, React.js, RxJS', ['Angular 21','Angular 18','TypeScript','JavaScript ES6+','HTML5','CSS3','SCSS','React.js','RxJS']],
 ['State & Architecture: Signals, NgRx, NX Monorepo, Standalone Components, Reactive Forms', ['Angular Signals','NgRx','Nx Workspace','Standalone Components','Reactive Forms']],
 ['UI: Angular Material, PrimeNG, AG Grid, FullCalendar, Tailwind CSS, Material UI, Bootstrap', ['Angular Material','PrimeNG','AG Grid','FullCalendar','Tailwind','Material UI','Bootstrap']],
 ['Backend & APIs: Node.js, Express.js, REST APIs, GraphQL, JWT Authentication', ['Node.js','Express.js','REST APIs','GraphQL','JWT Authentication']],
 ['Testing: Angular Unit Testing, Vitest, Angular TestBed', ['Angular Unit Testing','Vitest','Angular TestBed']],
 ['Databases: MySQL, MongoDB', ['MySQL','MongoDB']],
 ['Cloud & DevOps: AWS (S3, RDS, EC2, SNS, SES), Docker, CI/CD, GitHub Actions', ['AWS S3','AWS RDS','AWS EC2','AWS SNS','AWS SES','Docker','CI/CD','GitHub Actions']],
 ['Version Control: Git, GitHub', ['Git/GitHub']],
 ['Integrations: Socket.io, Firebase, Razorpay, SendGrid, WhatsApp API, Zego Cloud, Google Maps API, Chart.js', ['Socket.io','Firebase','Razorpay','Sendgrid','WhatsApp API','Zego Cloud','Google Maps API','Chart.js']],
 ['Tools & Methodologies: JIRA, Zoho Sprint, Agile/Scrum', ['JIRA','Zoho Sprint','Agile/Scrum']],
];
const highlights: Array<[string,string]> = [
 ['I have 3+ years of experience building production Angular and Node.js applications.', 'SUMMARY: Software Engineer with 3+ years of experience building production Angular and Node.js applications.'],
 ['I have built Angular 21 frontends using Signals and maintained an Nx monorepo with shared libraries.', 'Twisted Mountain Animation: Built modern frontend applications using Angular 21 and Signals; designed and maintained an NX monorepo with shared libraries.'],
 ['I have developed full-stack applications using Angular 18 and Node.js with REST APIs.', 'UFS: Architected and developed full-stack applications using Angular 18 and Node.js, implementing REST APIs for application functionality and data integration.'],
 ['I have developed Node.js/Express REST APIs and applications backed by MySQL and MongoDB.', 'SUMMARY: Hands-on experience developing Node.js/Express REST APIs ... applications backed by MySQL and MongoDB.'],
 ['I have optimized Angular components and lazy loading to reduce application load time by 40%.', 'UFS: optimized Angular components and lazy loading to reduce application load time by 40%.'],
 ['I have implemented GraphQL data-access layers with real-time subscriptions.', 'Twisted Mountain Animation: Implemented GraphQL data-access layers with real-time subscriptions, reducing over-fetching.'],
 ['I have implemented Angular unit tests using Vitest and Angular TestBed.', 'Twisted Mountain Animation: Implemented Angular unit tests using Vitest and Angular TestBed, covering component behavior, signal-based state changes, event emissions, service interactions, and user actions.'],
 ['I have built CI/CD pipelines using GitHub Actions, reducing deployment time by 60%.', 'UFS: Built CI/CD pipelines using GitHub Actions, reducing deployment time by 60%.'],
 ['I have developed reusable UI components using PrimeNG and integrated AG Grid and FullCalendar.', 'Twisted Mountain Animation: Developed reusable and accessible UI components using PrimeNG, and integrated AG Grid and FullCalendar.'],
 ['I have developed real-time chat and video-calling capabilities using Socket.io and Zego Cloud.', 'UFS: Engineered real-time chat and video-calling capabilities using Socket.io and Zego Cloud.'],
];
export const candidateProfile = {
 fullName: 'Shajmil VJ', headline: 'Software Engineer | Angular | Node.js', professionalExperienceYears: 3,
 baseLocation: 'Thrissur, Kerala, India',
 targetAnnualSalaryLakhs: 12,
 // Application preference, not a claim of four years of experience.
 maximumRequiredExperienceYears: 4,
 targetRoleTitles: ['Angular Developer','Frontend Developer','Frontend Engineer','Software Engineer','Software Developer','Web Developer','Full Stack Developer'],
 matchingPreferences: {showAllAngularMentions:true,preferAngularNode:true,skipRequiredJava:true,showAngularDotnetAtLowerPriority:true},
 cvSource: 'SHAJMIL VJ - Software Engineer.pdf',
 verifiedSkills: skillGroups.flatMap(([evidence,names])=>names.map(name=>({name,evidence,source:'cv' as const}))),
 verifiedHighlights: highlights.map(([statement,evidence],i)=>({id:`cv-${i+1}`,statement,evidence,source:'cv' as const})),
 education: ['BCA','MCA'],
 certifications: ['MEAN/MERN Full Stack Development — NACTET | 2023','Complete Angular Developer — Udemy | 2023','The Complete JavaScript Course — Udemy | 2023','Ethical Hacking — Internshala | 2022'],
};
