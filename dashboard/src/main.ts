import '@angular/compiler';
import { ChangeDetectionStrategy, Component, computed, effect, provideZonelessChangeDetection, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface ScreeningAnswer { question: string; classification: string; answer?: string }
interface JobSummary {
 jobDescription?: string; recommended?: boolean; id: string; companyName: string; roleTitle: string; locationText: string | null; normalizedLocation: string | null; workMode: string | null;
 salaryText: string | null; sourceName: string; applicationStatus: string; finalScore: number | null; deterministicScore: number | null;
 overrideScore: number | null; confidence: number | null; discoveredAt: string; jobActive: boolean; skipReason: string | null;
 applyMethod: string; riskFlags: string[] | null; llmCost: number;
}
interface JobDetail extends JobSummary {
 experienceRequiredText: string | null; semanticScore: number | null; originalScore: number | null; overrideReason: string | null;
 matchReasoning: string | null; identifiedGaps: string | null; strengths: string[] | null; applyUrl: string; applyEmailAddress: string | null;
 tailoredEmailSubject: string | null; tailoredEmailBody: string | null; jobDescription: string; resumeFilename: string | null; resumeError?: string;
 approvalVersion: string | null; sendingEnabled: boolean; screeningData: ScreeningAnswer[] | null; scoringModel: string | null;
 lastVerifiedAt: string | null; llmInputTokens: number; llmOutputTokens: number;
 scoreExplanation: { total: number; relevance: string; items: Array<{ label: string; points: number }> };
}
interface SourceHealth { source: string; slug: string; healthy: boolean; lastSuccessAt: string | null; lastFailureAt: string | null; lastListings: number | null; lastError: string | null; consecutiveFailures: number }
interface Run { id: string; startedAt: string; status: string; durationMs: number | null; jobsDiscovered: number; jobsNew: number; jobsScored: number; jobsQualified: number; jobsSkipped: number; errors: number }
interface AgentEvent { id: string; eventType: string; message: string; createdAt: string; roleTitle: string | null; companyName: string | null }
interface Delivery { id: string; roleTitle: string | null; companyName: string | null; recipientAddress: string | null; outcomeStatus: string; approvedByUserAt: string | null; submittedAt: string; providerMessageId: string | null; notes: string | null }
interface Metrics {
 summary: { jobs: number; qualified: number; averageScore: number | null; averageConfidence: number | null; llmCost: number; applicationsSent: number; expiredJobs: number; duplicates: number; sourceFailures: number; applicationErrors: number; scoringErrors: number; skippedBeforeLlm: number; overrides: number; falsePositiveFeedback: number; averageDiscoveryToApprovalMs: number | null; averageApprovalToSubmissionMs: number | null };
 statuses: Array<{ key: string; n: number }>; skipReasons: Array<{ key: string; n: number }>; sources: SourceHealth[]; runs: Run[]; events: AgentEvent[]; applications: Delivery[];
}

const THRESHOLD = 75, LOW_CONFIDENCE = 70;
const SKIP_LABELS: Record<string, string> = {
 NO_ANGULAR_RELEVANCE: 'No Angular relevance', LOCATION_MISMATCH: 'Location mismatch', REACT_PRIMARY: 'React is the primary stack', JAVA_PRIMARY: 'Java is the primary stack',
 DOTNET_PRIMARY: '.NET is the primary stack', PHP_PRIMARY: 'PHP is the primary stack', INTERNSHIP: 'Internship', FRESHER: 'Fresher role', EXPERIENCE_TOO_LOW: 'Experience below your level',
 EXPERIENCE_TOO_HIGH: 'Experience above your level', DUPLICATE: 'Duplicate listing', JOB_EXPIRED: 'Listing expired', JOB_CLOSED: 'Listing closed', LOW_MATCH_SCORE: 'Match score below 75',
 INSUFFICIENT_INFORMATION: 'Not enough information', OTHER: 'Skipped by you'
};
const LOCATION_LABELS: Record<string, string> = { REMOTE_INDIA: 'Remote (India)', KOCHI: 'Kochi', TRIVANDRUM: 'Trivandrum', OTHER_INDIA: 'Elsewhere in India', RELOCATION_REQUIRED: 'Relocation required', OUTSIDE_INDIA: 'Outside India', UNKNOWN: 'Unclear location' };
const SOURCE_LABELS: Record<string, string> = { greenhouse: 'Greenhouse', lever: 'Lever', infopark: 'Infopark', technopark: 'Technopark', cutshort: 'Cutshort', hirist: 'Hirist', career: 'Career pages', manual: 'Added by you', linkedin:'LinkedIn', naukri:'Naukri' };
const HIDDEN_SOURCES_KEY = 'jobReviewDesk.hiddenSources', DEFAULT_HIDDEN_SOURCES: string[] = [];
function readHiddenSources(): string[] {
 try { const v = JSON.parse(localStorage.getItem(HIDDEN_SOURCES_KEY) ?? 'null'); return Array.isArray(v) && v.every(s => typeof s === 'string') ? v : DEFAULT_HIDDEN_SOURCES; }
 catch { return DEFAULT_HIDDEN_SOURCES; }
}
const CLASSIFICATION_LABELS: Record<string, string> ={ AUTO_ANSWER: 'Answered from CV', ASK_USER: 'Needs your answer', DO_NOT_ANSWER: 'Will not be answered' };

@Component({
 selector: 'app-root',
 imports: [FormsModule, DecimalPipe],
 changeDetection: ChangeDetectionStrategy.OnPush,
 host: { '(document:keydown.escape)': 'closeDetail()' },
 template: `
<header class="topbar">
 <div class="brand"><span class="mark" aria-hidden="true">J</span><div><p class="eyebrow">Job search agent</p><h1>Review desk</h1></div></div>
 @if (connected()) {
 <nav class="views" aria-label="Views">
 <button type="button" [class.active]="view()==='queue'" (click)="view.set('queue')">Review queue</button>
 <button type="button" [class.active]="view()==='activity'" (click)="view.set('activity')">Activity</button>
 </nav>
 }
 <span class="pill">Nothing is sent without your approval</span>
</header>

<main>
 @if (notice()) { <p class="toast" role="status">{{ notice() }}</p> }

 @if (!connected()) {
 <section class="login card">
 <h2>Connect to your workspace</h2>
 <p class="muted">Enter the dashboard access token configured on the server. It is kept in this tab's memory only.</p>
 <form (ngSubmit)="connect()">
 <label for="token">Access token</label>
 <input id="token" name="token" type="password" autocomplete="off" [(ngModel)]="token">
 <button type="submit" class="primary" [disabled]="loading() || !token()">{{ loading() ? 'Connecting…' : 'Open review desk' }}</button>
 </form>
 @if (error()) { <p class="alert" role="alert">{{ error() }}</p> }
 </section>
 } @else if (view()==='queue') {
 <div class="intro">
 <div><h2>Find the right fit</h2><p class="muted">Review the evidence, refine the message, and decide what happens next.</p></div>
 <div class="intro-actions">
 <button type="button" class="secondary" (click)="openImport()">Add a job</button>
 <button type="button" class="secondary" (click)="refresh()" [disabled]="loading()">{{ loading() ? 'Refreshing…' : 'Refresh' }}</button>
 </div>
 </div>
 @if (error() && !selected()) { <p class="alert" role="alert">{{ error() }}</p> }

 <section class="stats" aria-label="Summary">
 <article><p class="eyebrow">Waiting for approval</p><strong>{{ count('Waiting for approval') }}</strong></article>
 <article><p class="eyebrow">Applications</p><strong>{{ applicationCount() }}</strong></article>
 <article><p class="eyebrow">Average confidence</p><strong>{{ averageConfidence() === null ? '—' : averageConfidence() + '%' }}</strong></article>
 <article><p class="eyebrow">LLM cost (USD)</p><strong>{{ cost() | number:'1.2-4' }}</strong></article>
 </section>

 <nav class="tabs" aria-label="Status">
 @for (s of statuses; track s) {
 <button type="button" [class.active]="status()===s" (click)="status.set(s)">{{ s }} <span class="count">{{ s==='All' ? visibleJobs().length : count(s) }}</span></button>
 }
 </nav>

 <div class="source-toggles" role="group" aria-label="Show jobs from these sources">
 <span class="toggle-label">Sources</span>
 @for (s of sources(); track s) {
 <button type="button" class="source-toggle" [class.on]="!isHidden(s)" [attr.aria-pressed]="!isHidden(s)" (click)="toggleSource(s)" [title]="isHidden(s) ? 'Show ' + sourceLabel(s) + ' jobs' : 'Hide ' + sourceLabel(s) + ' jobs'">
 <span class="tick" aria-hidden="true"></span>{{ sourceLabel(s) }}<span class="count">{{ sourceCount(s) }}</span>
 </button>
 }
 @if (hiddenSources().length) { <button type="button" class="link" (click)="showAllSources()">Show all sources</button> }
 </div>

 <section class="filters" aria-label="Filters">
 <label>Search<input name="search" [(ngModel)]="search" placeholder="Search title, company or full JD"></label>
 <label class="narrow">Minimum score<input name="minScore" type="number" min="0" max="100" [(ngModel)]="minScore"></label>
 <label>Location<select name="location" [(ngModel)]="location"><option value="">All locations</option>@for (l of locations(); track l) {<option [value]="l">{{ locationLabel(l) }}</option>}</select></label>
 <label>Work mode<select name="mode" [(ngModel)]="mode"><option value="">All modes</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="onsite">Onsite</option><option value="unknown">Unknown</option></select></label>
 <label>Salary<select name="salary" [(ngModel)]="salary"><option value="">Any salary</option><option value="known">Disclosed</option><option value="unknown">Undisclosed</option></select></label>
 <label>Found since<input name="since" type="date" [(ngModel)]="since"></label>
 </section>

 <div class="inline-actions"><button type="button" class="secondary" (click)="resetFilters()">Reset filters & show all sources</button><button type="button" class="secondary" (click)="rescoreJobs()" [disabled]="busy()">Re-evaluate existing jobs</button></div>
 <details class="card"><summary>Find and import Naukri / LinkedIn jobs</summary>
 <p>Open a search, then use Add job for a listing or import multiple jobs below. Imported listings are scored against your CV and appear under their original source. These boards are not automatically crawled.</p>
 <div class="inline-actions"><a href="https://www.linkedin.com/jobs/search/?keywords=Angular%20Node.js&location=India" target="_blank" rel="noopener noreferrer">LinkedIn · Angular / Node</a><a href="https://www.naukri.com/angular-developer-jobs?experience=3" target="_blank" rel="noopener noreferrer">Naukri · Angular</a><button type="button" class="secondary" (click)="openImport()">Add job</button></div>
 <label>Paste a JSON array of jobs<textarea rows="5" [(ngModel)]="boardImport" placeholder='[{"applyUrl":"https://www.linkedin.com/jobs/view/123", "companyName":"Company", "roleTitle":"Software Engineer", "locationText":"Kochi", "jobDescription":"Paste the full job description here..."}]'></textarea></label>
 <button type="button" class="secondary" (click)="importBoards()" [disabled]="busy() || !boardImport().trim()">Import and score jobs</button>
 </details>
 <p class="result-count muted">{{ filtered().length }} of {{ visibleJobs().filter(inTab).length }} jobs in this tab · {{ jobs().length }} total jobs@if (hiddenInTab()) { · {{ hiddenInTab() }} more in hidden sources }</p>
 <section class="jobs">
 @for (j of filtered(); track j.id) {
 <button type="button" class="job card" (click)="openJob(j)">
 <div class="job-main">
 <p class="eyebrow">{{ j.companyName }} · {{ j.sourceName }}</p>
 <h3>{{ j.roleTitle }}</h3>
 <p class="meta">{{ j.locationText || 'Location not stated' }} · {{ modeLabel(j.workMode) }}</p>
 <p class="meta">{{ j.salaryText || 'Salary undisclosed' }} · found {{ age(j.discoveredAt) }}</p>
 <div class="chips">
 <span [class]="'chip ' + statusTone(j.applicationStatus)">{{ j.applicationStatus }}</span>
 <span class="chip">{{ priorityLabel(j) }}</span>
 @if (needsReview(j)) { <span class="chip warn">Low confidence: review carefully</span> }
 @if (!j.jobActive) { <span class="chip danger">Closed</span> }
 @if (j.applyMethod !== 'email') { <span class="chip">ATS form</span> }
 @if (j.applicationStatus==='Skipped' && j.skipReason) { <span class="chip">{{ skipLabel(j.skipReason) }}</span> }
 </div>
 </div>
 @if (score(j) !== null) {
 <div class="score">
 <strong>{{ score(j) | number:'1.0-1' }}</strong>
 <span>match score</span>
 <span>{{ j.confidence === null ? 'not evaluated' : j.confidence + '% confidence' }}</span>
 </div>
 } @else {
 <div class="score muted-score">
 <strong>{{ j.deterministicScore ?? '—' }}</strong>
 <span>{{ j.deterministicScore === null ? 'not scored' : 'evidence score' }}</span>
 <span>{{ j.deterministicScore === null ? '' : 'LLM scoring pending' }}</span>
 </div>
 }
 </button>
 } @empty {
 <div class="empty card">
 @if (loading()) { <p>Loading jobs…</p> }
 @else if (jobs().length) { <p><b>No jobs match these filters.</b></p><p class="muted">Try another status or clear a filter.</p> }
 @else { <p><b>Your review queue is empty.</b></p><p class="muted">Run discovery with <code>npm run run:once</code>, then refresh.</p> }
 </div>
 }
 </section>
 } @else {
 <div class="intro">
 <div><h2>Activity</h2><p class="muted">Runs, sources, costs, and every delivery record.</p></div>
 <button type="button" class="secondary" (click)="refresh()" [disabled]="loading()">{{ loading() ? 'Refreshing…' : 'Refresh' }}</button>
 </div>
 @if (error()) { <p class="alert" role="alert">{{ error() }}</p> }
 @if (metrics(); as m) {
 <section class="stats wide" aria-label="Totals">
 <article><p class="eyebrow">Jobs tracked</p><strong>{{ m.summary.jobs }}</strong></article>
 <article><p class="eyebrow">Applications sent</p><strong>{{ m.summary.applicationsSent }}</strong></article>
 <article><p class="eyebrow">Average score</p><strong>{{ m.summary.averageScore === null ? '—' : (m.summary.averageScore | number:'1.0-1') }}</strong></article>
 <article><p class="eyebrow">Average confidence</p><strong>{{ m.summary.averageConfidence === null ? '—' : (m.summary.averageConfidence | number:'1.0-0') + '%' }}</strong></article>
 <article><p class="eyebrow">LLM cost (USD)</p><strong>{{ m.summary.llmCost | number:'1.2-4' }}</strong></article>
 <article><p class="eyebrow">Skipped before LLM</p><strong>{{ m.summary.skippedBeforeLlm }}</strong></article>
 <article><p class="eyebrow">Duplicates</p><strong>{{ m.summary.duplicates }}</strong></article>
 <article><p class="eyebrow">Closed listings</p><strong>{{ m.summary.expiredJobs }}</strong></article>
 <article [class.attention]="m.summary.sourceFailures"><p class="eyebrow">Source failures</p><strong>{{ m.summary.sourceFailures }}</strong></article>
 <article [class.attention]="m.summary.scoringErrors"><p class="eyebrow">Scoring errors</p><strong>{{ m.summary.scoringErrors }}</strong></article>
 <article [class.attention]="m.summary.applicationErrors"><p class="eyebrow">Application errors</p><strong>{{ m.summary.applicationErrors }}</strong></article>
 <article><p class="eyebrow">False positives flagged</p><strong>{{ m.summary.falsePositiveFeedback }}</strong></article>
 </section>
 <p class="muted timing">Average time from discovery to approval: <b>{{ duration(m.summary.averageDiscoveryToApprovalMs) }}</b>. From approval to sending: <b>{{ duration(m.summary.averageApprovalToSubmissionMs) }}</b>.</p>

 <div class="grid-2">
 <section class="card panel">
 <h3>Source health</h3>
 @for (s of m.sources; track s.source + s.slug) {
 <div class="row">
 <span class="dot" [class.ok]="s.healthy" [attr.aria-label]="s.healthy ? 'Healthy' : 'Failing'"></span>
 <div class="grow"><b>{{ s.slug }}</b><span class="muted source-name">{{ s.source }}</span>
 <p class="small muted">
 @if (s.healthy) { {{ s.lastListings }} listings, fetched {{ when(s.lastSuccessAt) }} }
 @else { {{ s.consecutiveFailures }} failed fetch{{ s.consecutiveFailures === 1 ? '' : 'es' }} in a row. Last error: {{ s.lastError }} }
 </p>
 </div>
 </div>
 } @empty { <p class="muted">No source fetches recorded yet.</p> }
 </section>
 <section class="card panel">
 <h3>Why jobs were skipped</h3>
 @for (r of m.skipReasons; track r.key) {
 <div class="bar-row"><span>{{ skipLabel(r.key) }}</span><span class="bar"><span [style.width.%]="barWidth(r.n, m.skipReasons)"></span></span><b>{{ r.n }}</b></div>
 } @empty { <p class="muted">No skipped jobs.</p> }
 </section>
 </div>

 <section class="card panel">
 <h3>Recent runs</h3>
 <div class="table-wrap"><table>
 <thead><tr><th>Started</th><th>Status</th><th>Duration</th><th>Listings</th><th>New</th><th>Scored</th><th>Qualified</th><th>Skipped</th><th>Errors</th></tr></thead>
 <tbody>
 @for (r of m.runs; track r.id) {
 <tr><td>{{ when(r.startedAt) }}</td><td><span [class]="'chip ' + runTone(r.status)">{{ r.status }}</span></td><td>{{ duration(r.durationMs) }}</td><td>{{ r.jobsDiscovered }}</td><td>{{ r.jobsNew }}</td><td>{{ r.jobsScored }}</td><td>{{ r.jobsQualified }}</td><td>{{ r.jobsSkipped }}</td><td [class.danger-text]="r.errors">{{ r.errors }}</td></tr>
 } @empty { <tr><td colspan="9" class="muted">No runs yet.</td></tr> }
 </tbody>
 </table></div>
 </section>

 <section class="card panel">
 <h3>Delivery records</h3>
 <div class="table-wrap"><table>
 <thead><tr><th>Role</th><th>Recipient</th><th>Status</th><th>Approved</th><th>Sent</th><th>Notes</th></tr></thead>
 <tbody>
 @for (a of m.applications; track a.id) {
 <tr><td><b>{{ a.roleTitle }}</b><br><span class="muted">{{ a.companyName }}</span></td><td>{{ a.recipientAddress }}</td><td><span [class]="'chip ' + statusTone(a.outcomeStatus)">{{ a.outcomeStatus }}</span></td><td>{{ when(a.approvedByUserAt) }}</td><td>{{ a.providerMessageId ? when(a.submittedAt) : '—' }}</td><td class="small">{{ a.notes }}</td></tr>
 } @empty { <tr><td colspan="6" class="muted">No applications have been sent.</td></tr> }
 </tbody>
 </table></div>
 </section>

 <section class="card panel">
 <div class="panel-head"><h3>Recent events</h3>@if (m.events.length > eventPreview) { <button type="button" class="link" (click)="showAllEvents.set(!showAllEvents())">{{ showAllEvents() ? 'Show fewer' : 'Show all ' + m.events.length }}</button> }</div>
 <ul class="events">
 @for (e of showAllEvents() ? m.events : m.events.slice(0, eventPreview); track e.id) {
 <li><span class="event-type" [class.danger-text]="isErrorEvent(e.eventType)">{{ e.eventType }}</span><span class="grow">{{ e.message }}@if (e.roleTitle) { <span class="muted"> · {{ e.roleTitle }}, {{ e.companyName }}</span> }</span><time class="muted small">{{ when(e.createdAt) }}</time></li>
 } @empty { <li class="muted">No events recorded.</li> }
 </ul>
 </section>
 } @else { <p class="muted">Loading activity…</p> }
 }
</main>

@if (importOpen()) {
<div class="overlay" (click)="importOpen.set(false)"></div>
<section class="detail" role="dialog" aria-modal="true" aria-labelledby="import-title">
 <div class="detail-head">
 <div><p class="eyebrow">Manual import</p><h2 id="import-title">Add a job you found</h2></div>
 <button type="button" id="import-close" class="secondary" (click)="importOpen.set(false)">Close</button>
 </div>
 <form class="detail-body" (ngSubmit)="importJob()">
 <p class="muted">Use this for listings you read yourself on LinkedIn, Naukri, Indeed or a company website. Paste the full description so the job is filtered, scored and drafted like any other. Manually added jobs are applied to through their original link.</p>
 <label for="import-url">Job link</label>
 <input id="import-url" name="importUrl" type="url" placeholder="https://www.linkedin.com/jobs/view/…" [(ngModel)]="importUrl" required>
 <div class="grid-2 compact">
 <label>Company<input name="importCompany" [(ngModel)]="importCompany" required></label>
 <label>Role title<input name="importRole" [(ngModel)]="importRole" required></label>
 </div>
 <label for="import-location">Location</label>
 <input id="import-location" name="importLocation" placeholder="e.g. Kochi, Kerala (Hybrid) or Remote, India" [(ngModel)]="importLocation">
 <label for="import-description">Full job description</label>
 <textarea id="import-description" name="importDescription" rows="14" [(ngModel)]="importDescription" required></textarea>
 <p class="small muted">{{ importDescription().trim().length }} characters. At least 100 are needed.</p>
 @if (error()) { <p class="alert" role="alert">{{ error() }}</p> }
 <div class="inline-actions"><button type="submit" class="primary" [disabled]="busy() || !importReady()">{{ busy() ? 'Adding…' : 'Add and score' }}</button></div>
 </form>
</section>
}

@if (selected(); as j) {
<div class="overlay" (click)="closeDetail()"></div>
<section class="detail" role="dialog" aria-modal="true" aria-labelledby="detail-title">
 <div class="detail-head">
 <div>
 <p class="eyebrow">{{ j.companyName }} · {{ j.sourceName }}</p>
 <h2 id="detail-title">{{ j.roleTitle }}</h2>
 </div>
 <button type="button" id="detail-close" class="secondary" (click)="closeDetail()">Close</button>
 </div>
 <div class="detail-body">
 <div class="chips">
 <span class="chip">{{ j.locationText || 'Location not stated' }}</span>
 <span class="chip">{{ modeLabel(j.workMode) }}</span>
 <span class="chip">{{ j.salaryText || 'Salary undisclosed' }}</span>
 <span class="chip">Experience: {{ experience(j.experienceRequiredText) }}</span>
 <span class="chip">Found {{ age(j.discoveredAt) }}</span>
 <span [class]="'chip ' + statusTone(j.applicationStatus)">{{ j.applicationStatus }}</span>
 @if (!j.jobActive) { <span class="chip danger">Listing closed</span> }
 </div>

 <section class="card score-panel">
 <div class="big-score">
 <strong>{{ score(j) === null ? '—' : (score(j) | number:'1.0-1') }}</strong>
 <span>{{ j.overrideScore !== null ? 'overridden score' : 'match score' }}</span>
 </div>
 <div class="breakdown">
 <div class="bar-row"><span>Evidence match (60%)</span><span class="bar"><span [style.width.%]="j.deterministicScore ?? 0"></span></span><b>{{ j.deterministicScore ?? '—' }}</b></div>
 <div class="bar-row"><span>Semantic fit (40%)</span><span class="bar"><span [style.width.%]="j.semanticScore ?? 0"></span></span><b>{{ j.semanticScore ?? '—' }}</b></div>
 <div class="bar-row"><span>Confidence</span><span class="bar" [class.low]="(j.confidence ?? 100) < lowConfidence"><span [style.width.%]="j.confidence ?? 0"></span></span><b>{{ j.confidence === null ? '—' : j.confidence + '%' }}</b></div>
 @if (j.overrideScore !== null) { <p class="small muted">Original score {{ j.originalScore ?? '—' }}. Override reason: {{ j.overrideReason }}</p> }
 @if (j.scoringModel) { <p class="small muted">Scored by {{ j.scoringModel }} · {{ j.llmInputTokens + j.llmOutputTokens }} tokens · {{ j.llmCost | number:'1.2-4' }} USD</p> }
 </div>
 </section>
 <details class="card evidence" [open]="j.applicationStatus === 'Skipped' || j.semanticScore === null">
 <summary>How the evidence score of {{ j.scoreExplanation.total }} was calculated</summary>
 <ul class="evidence-list">
 @for (item of j.scoreExplanation.items; track $index) {
 <li [class.minus]="item.points < 0"><span>{{ item.label }}</span><b>{{ item.points > 0 ? '+' : '' }}{{ item.points }}</b></li>
 }
 </ul>
 <p class="small muted">Eligible Angular listings stay visible at every score. Angular + Node.js has highest priority; Angular + .NET and optional Angular roles remain visible with gaps. Required Java and roles requiring more than four years are excluded. Only CV-backed skills earn points.</p>
 </details>
 @if (needsReview(j)) { <p class="callout warn">The score qualifies but the model's confidence is low. Check the gaps and the full description before approving.</p> }

 <h3>{{ j.applicationStatus === 'Skipped' ? 'Why it was skipped' : 'Why it matches' }}</h3>
 <p>{{ j.matchReasoning || 'No semantic evaluation yet.' }}</p>
 @if (j.strengths?.length) { <ul class="list">@for (s of j.strengths; track $index) {<li>{{ s }}</li>}</ul> }

 <h3>Gaps and risks</h3>
 @if (gaps(j).length) { <ul class="list">@for (g of gaps(j); track $index) {<li>{{ g }}</li>}</ul> } @else { <p class="muted">No gaps recorded.</p> }
 @if (j.riskFlags?.length) { <div class="chips">@for (f of j.riskFlags; track $index) {<span class="chip warn">{{ riskLabel(f) }}</span>}</div> }
 @if (j.skipReason) { <p><b>Skip reason:</b> {{ skipLabel(j.skipReason) }}</p> }
 <p><a [href]="j.applyUrl" target="_blank" rel="noopener noreferrer">Open the original listing ↗</a></p>
 <details class="card description"><summary>Full job description</summary><p>{{ j.jobDescription }}</p></details>

 <h3>Application preview</h3>
 <dl class="facts">
 <dt>Method</dt><dd>{{ j.applyMethod === 'email' ? 'Email' : 'ATS form (apply manually on the listing)' }}</dd>
 <dt>Recipient</dt><dd>{{ j.applyEmailAddress || 'None. Apply through the job website.' }}</dd>
 <dt>Resume</dt><dd>@if (j.resumeFilename) { {{ j.resumeFilename }} <button type="button" class="link" (click)="viewResume()">View</button> } @else { <span class="danger-text">{{ j.resumeError }}</span> }</dd>
 </dl>
 @if (j.tailoredEmailBody === null) { <p class="callout">No draft yet. Drafts are generated for jobs waiting for approval during the next run.</p> }
 <label for="subject">Subject</label>
 <input id="subject" name="subject" [(ngModel)]="subject">
 <label for="body">Message</label>
 <textarea id="body" name="body" rows="11" [(ngModel)]="body"></textarea>
 <div class="inline-actions">
 @if (draftDirty()) { <span class="small warn-text">Unsaved changes</span> }
 <button type="button" class="secondary" (click)="action('edit', {subject: subject(), body: body()})" [disabled]="busy() || !draftDirty()">Save draft</button>
 </div>

 <h3>Screening questions</h3>
 @for (q of j.screeningData ?? []; track q.question) {
 <div class="question card"><p><b>{{ q.question }}</b></p><p class="small"><span [class]="'chip ' + classificationTone(q.classification)">{{ classificationLabel(q.classification) }}</span> {{ q.answer || 'No answer supplied' }}</p></div>
 } @empty { <p class="muted">No screening questions added.</p> }
 <div class="grid-2 compact">
 <label>Question<input name="question" [(ngModel)]="question" placeholder="e.g. What is your notice period?"></label>
 <label>Your answer, when confirmation is needed<input name="answer" [(ngModel)]="answer"></label>
 </div>
 <div class="inline-actions"><button type="button" class="secondary" (click)="addQuestion()" [disabled]="busy() || !question().trim()">Classify and save</button></div>

 <details class="card"><summary>Override the score</summary>
 <p class="small muted">The original model decision is kept. Scores of 75 or more move the job to the approval queue.</p>
 <div class="grid-2 compact">
 <label>Score<input name="overrideScore" type="number" min="0" max="100" [(ngModel)]="overrideScore"></label>
 <label>Reason<input name="reason" [(ngModel)]="overrideReason"></label>
 </div>
 <div class="inline-actions"><button type="button" class="secondary" (click)="action('override', {score: overrideScore(), reason: overrideReason()})" [disabled]="busy() || !overrideReason().trim()">Save override</button></div>
 </details>

 @if (['Applied','Interview','Offer','Rejected'].includes(j.applicationStatus)) {
 <details class="card" open><summary>Record an outcome</summary>
 <label>Outcome<select name="outcome" [(ngModel)]="outcome"><option>Interview</option><option>Offer</option><option>Rejected</option></select></label>
 <div class="inline-actions"><button type="button" class="primary" (click)="action('outcome', {status: outcome()})" [disabled]="busy()">Update outcome</button></div>
 </details>
 }
 </div>

 @if (['New','Waiting for approval','Skipped'].includes(j.applicationStatus)) {
 <footer class="detail-actions">
 @if (error()) { <p class="alert" role="alert">{{ error() }}</p> }
 @if (approveBlockers().length) {
 <ul class="blockers">@for (b of approveBlockers(); track b) {<li>{{ b }}</li>}</ul>
 } @else {
 <label class="confirm"><input type="checkbox" name="approved" [(ngModel)]="approved"> I reviewed this exact message, recipient, resume, and screening answers, and I approve sending this application.</label>
 }
 @if (skipOpen()) {
 <div class="skip-form">
 <label>Why skip? (optional)<input name="skipReason" [(ngModel)]="skipReason" placeholder="e.g. Mostly backend Java work"></label>
 <label class="confirm"><input type="checkbox" name="falsePositive" [(ngModel)]="falsePositive"> The agent should not have recommended this job</label>
 </div>
 }
 <div class="actions">
 @if (skipOpen()) {
 <button type="button" class="secondary" (click)="skipOpen.set(false)">Cancel</button>
 <button type="button" class="danger" (click)="skip()" [disabled]="busy()">Confirm skip</button>
 } @else {
 @if (j.applicationStatus !== 'Skipped') { <button type="button" class="secondary" (click)="skipOpen.set(true)" [disabled]="busy()">Skip</button> }
 <button type="button" class="primary" (click)="approve()" [disabled]="busy() || !approved() || approveBlockers().length > 0">{{ busy() ? 'Working…' : 'Approve and send' }}</button>
 }
 </div>
 </footer>
 } @else if (error()) { <footer class="detail-actions"><p class="alert" role="alert">{{ error() }}</p></footer> }
</section>
}
`})
class App {
 readonly statuses = ['Recommended', 'Waiting for approval', 'New', 'Applied', 'Interview', 'Offer', 'Rejected', 'Skipped', 'All'];
 readonly lowConfidence = LOW_CONFIDENCE;
 token = signal(''); connected = signal(false); loading = signal(false); busy = signal(false);
 error = signal(''); notice = signal(''); view = signal<'queue' | 'activity'>('queue');
 jobs = signal<JobSummary[]>([]); metrics = signal<Metrics | null>(null); selected = signal<JobDetail | null>(null);
 status = signal('Recommended'); search = signal(''); minScore = signal(0); location = signal(''); mode = signal(''); salary = signal(''); since = signal('');
 // Sources hidden across every status tab. Remembered in this browser; Cutshort and Greenhouse start hidden.
 hiddenSources = signal<string[]>(readHiddenSources());
 subject = signal(''); body = signal(''); question = signal(''); answer = signal(''); overrideScore = signal(75); overrideReason = signal(''); outcome = signal('Interview');
 approved = signal(false); skipOpen = signal(false); skipReason = signal(''); falsePositive = signal(false);
 readonly eventPreview = 15; showAllEvents = signal(false);
 importOpen = signal(false); importUrl = signal(''); importCompany = signal(''); importRole = signal(''); importLocation = signal(''); importDescription = signal('');
 importReady = computed(() => /^https:\/\//.test(this.importUrl().trim()) && !!this.importCompany().trim() && this.importRole().trim().length >= 2 && this.importDescription().trim().length >= 100);
 #noticeTimer?: ReturnType<typeof setTimeout>;

 locations = computed(() => [...new Set(this.jobs().map(j => j.normalizedLocation ?? 'UNKNOWN'))].sort());
 boardImport = signal('');
 sources = computed(() => [...new Set([...this.jobs().map(j => j.sourceName), ...this.hiddenSources()])].sort((a, b) => this.sourceLabel(a).localeCompare(this.sourceLabel(b))));
 visibleJobs = computed(() => { const hidden = new Set(this.hiddenSources()); return this.jobs().filter(j => !hidden.has(j.sourceName)); });
 inTab = (j: JobSummary) => this.status() === 'All' || (this.status() === 'Recommended' ? !!j.recommended : j.applicationStatus === this.status());
 hiddenInTab = computed(() => { const hidden = new Set(this.hiddenSources()); return this.jobs().filter(j => hidden.has(j.sourceName) && this.inTab(j)).length; });
 cost = computed(() => this.visibleJobs().reduce((s, j) => s + (j.llmCost || 0), 0));
 averageConfidence = computed(() => { const c = this.visibleJobs().flatMap(j => j.confidence === null ? [] : [j.confidence]); return c.length ? Math.round(c.reduce((a, b) => a + b, 0) / c.length) : null; });
 applicationCount = computed(() => ['Applied', 'Interview', 'Offer', 'Rejected'].reduce((n, s) => n + this.count(s), 0));
 filtered = computed(() => {
 const q = this.search().toLowerCase(), min = Number(this.minScore()) || 0, since = this.since();
 return this.visibleJobs().filter(j => this.inTab(j)
 && (!q || `${j.roleTitle} ${j.companyName} ${j.jobDescription??''}`.toLowerCase().includes(q))
 && (min <= 0 || (this.score(j) ?? j.deterministicScore ?? 0) >= min)
 && (!this.location() || (j.normalizedLocation ?? 'UNKNOWN') === this.location())
 && (!this.mode() || (j.workMode ?? 'unknown') === this.mode())
 && (!since || j.discoveredAt.slice(0, 10) >= since)
 && (!this.salary() || (this.salary() === 'known' ? !!j.salaryText : !j.salaryText)))
 .sort((a, b) => this.priorityRank(b)-this.priorityRank(a) || (this.score(b) ?? b.deterministicScore ?? -1) - (this.score(a) ?? a.deterministicScore ?? -1));
 });
 draftDirty = computed(() => { const j = this.selected(); return !!j && (this.subject() !== (j.tailoredEmailSubject ?? '') || this.body() !== (j.tailoredEmailBody ?? '')); });
 approveBlockers = computed(() => {
 const j = this.selected(); if (!j) return [];
 const blockers: string[] = [];
 if (!j.sendingEnabled) blockers.push('Application sending is turned off on the server.');
 if (j.applicationStatus !== 'Waiting for approval') blockers.push('Only jobs waiting for approval can be sent.');
 if (!j.jobActive) blockers.push('This listing is closed.');
 if (j.applyMethod !== 'email') blockers.push('This listing uses an ATS form. Apply manually through the original listing.');
 if (!j.tailoredEmailBody) blockers.push('There is no draft message yet.');
 if (!j.approvalVersion) blockers.push(j.resumeError ? `Resume problem: ${j.resumeError}` : 'The resume is not configured.');
 if (this.draftDirty()) blockers.push('Save your draft changes before approving.');
 if ((j.screeningData ?? []).some(q => q.classification === 'ASK_USER' && !q.answer)) blockers.push('Answer the screening questions that need your confirmation.');
 return blockers;
 });

 constructor() {
 effect(() => document.body.classList.toggle('drawer-open', !!this.selected()));
 effect(() => { try { localStorage.setItem(HIDDEN_SOURCES_KEY, JSON.stringify(this.hiddenSources())); } catch { /* storage unavailable: choice lasts for this tab */ } });
 }

 count(s: string) { return this.visibleJobs().filter(j => (s==='Recommended'?j.recommended:j.applicationStatus === s)).length; }
 isHidden(source: string) { return this.hiddenSources().includes(source); }
 toggleSource(source: string) { this.hiddenSources.update(list => list.includes(source) ? list.filter(s => s !== source) : [...list, source]); }
 resetFilters() { this.search.set('');this.minScore.set(0);this.location.set('');this.mode.set('');this.salary.set('');this.since.set('');this.hiddenSources.set([]); }
 async rescoreJobs() { this.busy.set(true);this.error.set('');try{await this.api('rescore',{});await this.load();this.flash('Existing jobs re-evaluated.');}catch(e){this.error.set(this.message(e));}finally{this.busy.set(false);} }
 async importBoards() { this.busy.set(true);this.error.set('');try{const r=await this.api<{created:number;duplicates:number}>('import-board-jobs',{jobs:JSON.parse(this.boardImport())});await this.load();this.resetFilters();this.status.set('All');this.boardImport.set('');this.flash(`${r.created} imported; ${r.duplicates} already tracked.`);}catch(e){this.error.set(this.message(e));}finally{this.busy.set(false);} }
 showAllSources() { this.hiddenSources.set([]); }
 sourceCount(source: string) { return this.jobs().filter(j => j.sourceName === source && this.inTab(j)).length; }
 sourceLabel(source: string) { return SOURCE_LABELS[source] ?? source; }
 priorityRank(j: JobSummary) { return j.riskFlags?.includes('PRIORITY_HIGH') ? 3 : j.riskFlags?.includes('PRIORITY_LOW') ? 1 : 2; }
 priorityLabel(j: JobSummary) { return this.priorityRank(j)===3 ? 'High priority · Angular + Node.js' : this.priorityRank(j)===1 ? 'Lower priority · review gaps' : 'Angular opportunity'; }
 score(j: JobSummary) { return j.overrideScore ?? j.finalScore; }
 needsReview(j: JobSummary) { const s = this.score(j); return s !== null && s >= THRESHOLD && (j.confidence !== null && j.confidence < LOW_CONFIDENCE || !!j.riskFlags?.includes('LOW_CONFIDENCE')); }
 riskLabel(k: string) { return ({PRIORITY_HIGH:'High priority: Angular + Node.js',PRIORITY_NORMAL:'Angular opportunity',PRIORITY_LOW:'Lower priority: review gaps',ANGULAR_OPTIONAL_OR_COMPANY_CONTEXT:'Angular is optional or company context',AI_ASSISTANT_EXPERIENCE_NOT_VERIFIED:'AI-assistant experience is not verified by the CV',SEMANTIC_EVALUATION_PENDING:'Semantic evaluation pending',LOW_SCORE_REVIEW:'Low score — shown for your review',REQUIRED_PHP_NOT_ON_CV:'Required PHP proficiency is not on the CV',REQUIRED_PYTHON_NOT_ON_CV:'Required Python proficiency is not on the CV',REQUIRED__NET_NOT_ON_CV:'Required .NET proficiency is not on the CV'} as Record<string,string>)[k] ?? k; }
 skipLabel(k: string) { return SKIP_LABELS[k] ?? k; }
 locationLabel(k: string) { return LOCATION_LABELS[k] ?? k; }
 classificationLabel(k: string) { return CLASSIFICATION_LABELS[k] ?? k; }
 classificationTone(k: string) { return k === 'AUTO_ANSWER' ? 'ok' : k === 'ASK_USER' ? 'warn' : ''; }
 modeLabel(m: string | null) { return m && m !== 'unknown' ? m[0].toUpperCase() + m.slice(1) : 'Work mode unclear'; }
 statusTone(s: string) { return ({ 'Waiting for approval': 'info', Applied: 'ok', Interview: 'ok', Offer: 'ok', Rejected: 'danger', 'Delivery uncertain': 'danger', Sending: 'warn' } as Record<string, string>)[s] ?? ''; }
 runTone(s: string) { return s === 'Completed' ? 'ok' : s === 'Failed' ? 'danger' : s === 'Partial' ? 'warn' : 'info'; }
 isErrorEvent(t: string) { return /ERROR|FAILURE|BLOCKED/.test(t); }
 barWidth(n: number, rows: Array<{ n: number }>) { return Math.max(4, Math.round(n / Math.max(...rows.map(r => r.n)) * 100)); }
 gaps(j: JobDetail): string[] { if (!j.identifiedGaps) return []; try { const v = JSON.parse(j.identifiedGaps); return Array.isArray(v) ? v.map(String) : [String(v)]; } catch { return [j.identifiedGaps]; } }
 experience(text: string | null) {
 if (!text || text === 'null') return 'not specified';
 try { const r = JSON.parse(text) as { min: number; max: number }; return r.max >= 99 ? `${r.min}+ years` : `${r.min}–${r.max} years`; } catch { return text; }
 }
 age(iso: string) { const d = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)); return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; }
 when(iso: string | null) { return iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'; }
 duration(ms: number | null) {
 if (ms === null || ms === undefined) return '—';
 const s = Math.round(ms / 1000); if (s < 60) return `${s}s`;
 const m = Math.round(s / 60); if (m < 120) return `${m} min`;
 const h = Math.round(m / 60); return h < 48 ? `${h} h` : `${Math.round(h / 24)} days`;
 }

 async api<T>(path: string, data?: unknown): Promise<T> {
 const r = await fetch('/api/' + path, { method: data ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + this.token(), 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined });
 const v = await r.json().catch(() => ({ error: `Request failed (${r.status})` }));
 if (!r.ok) throw new Error(v.error ?? `Request failed (${r.status})`);
 return v as T;
 }
 message(e: unknown) { return e instanceof Error ? e.message : String(e); }
 flash(text: string) { this.notice.set(text); clearTimeout(this.#noticeTimer); this.#noticeTimer = setTimeout(() => this.notice.set(''), 3500); }

 async connect() {
 this.loading.set(true); this.error.set('');
 try {
 await this.load(); this.connected.set(true);
 // Open where the work is: new jobs still awaiting scoring when nothing is ready for approval.
 if (!this.count('Recommended') && this.count('New')) this.status.set('New');
 }
 catch (e) { this.error.set(this.message(e)); }
 finally { this.loading.set(false); }
 }
 async load() {
 const [jobs, metrics] = await Promise.all([this.api<JobSummary[]>('jobs'), this.api<Metrics>('metrics')]);
 this.jobs.set(jobs); this.metrics.set(metrics);
 }
 async refresh() {
 this.loading.set(true); this.error.set('');
 try { await this.load(); } catch (e) { this.error.set(this.message(e)); } finally { this.loading.set(false); }
 }
 async openJob(j: JobSummary) {
 this.error.set('');
 try { this.open(await this.api<JobDetail>(`jobs/${j.id}/preview`)); setTimeout(() => document.getElementById('detail-close')?.focus()); }
 catch (e) { this.error.set(this.message(e)); }
 }
 open(j: JobDetail) {
 this.selected.set(j); this.subject.set(j.tailoredEmailSubject ?? ''); this.body.set(j.tailoredEmailBody ?? '');
 this.approved.set(false); this.skipOpen.set(false); this.skipReason.set(''); this.falsePositive.set(false);
 this.overrideScore.set(Math.round(j.overrideScore ?? j.finalScore ?? THRESHOLD));
 }
 closeDetail() { this.selected.set(null); this.importOpen.set(false); this.error.set(''); }
 openImport() { this.error.set(''); this.importOpen.set(true); setTimeout(() => document.getElementById('import-url')?.focus()); }
 async importJob() {
 if (this.busy() || !this.importReady()) return;
 this.busy.set(true); this.error.set('');
 try {
 const result = await this.api<{ jobId: string; created: boolean }>('import-job', { applyUrl: this.importUrl(), companyName: this.importCompany(), roleTitle: this.importRole(), locationText: this.importLocation(), jobDescription: this.importDescription() });
 await this.load();
 this.importOpen.set(false);
 for (const s of [this.importUrl, this.importCompany, this.importRole, this.importLocation, this.importDescription]) s.set('');
 const job = this.jobs().find(x => x.id === result.jobId);
 if (job) { this.status.set('All'); await this.openJob(job); }
 this.flash(result.created ? 'Job added and scored.' : 'This job is already tracked.');
 } catch (e) { this.error.set(this.message(e)); }
 finally { this.busy.set(false); }
 }
 async action(name: string, data: unknown, done = 'Saved.') {
 const j = this.selected(); if (!j || this.busy()) return;
 this.busy.set(true); this.error.set('');
 try {
 await this.api(`jobs/${j.id}/${name}`, data);
 await this.load();
 const fresh = await this.api<JobDetail>(`jobs/${j.id}/preview`);
 const keepDraft = name !== 'edit' && this.draftDirty() ? { subject: this.subject(), body: this.body() } : null;
 this.open(fresh);
 if (keepDraft) { this.subject.set(keepDraft.subject); this.body.set(keepDraft.body); }
 this.flash(done);
 } catch (e) { this.error.set(this.message(e)); }
 finally { this.busy.set(false); }
 }
 addQuestion() { void this.action('screening', { question: this.question(), answer: this.answer() }, 'Screening question saved.').then(() => { if (!this.error()) { this.question.set(''); this.answer.set(''); } }); }
 skip() { void this.action('skip', { reason: this.skipReason(), falsePositive: this.falsePositive() }, 'Job skipped.'); }
 approve() { const j = this.selected(); if (j && this.approved()) void this.action('approve', { approved: true, version: j.approvalVersion }, 'Application sent.'); }
 async viewResume() {
 try {
 const r = await fetch('/api/resume', { headers: { Authorization: 'Bearer ' + this.token() } });
 if (!r.ok) throw new Error('Could not load the resume');
 const url = URL.createObjectURL(await r.blob()); window.open(url, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(url), 60000);
 } catch (e) { this.error.set(this.message(e)); }
 }
}
bootstrapApplication(App, { providers: [provideZonelessChangeDetection()] }).catch(console.error);
