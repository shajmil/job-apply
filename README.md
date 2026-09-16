# Job Search Agent v2

Angular review dashboard and a Node/TypeScript/PostgreSQL workflow for job discovery, evidence-based ranking, application preparation, explicit approval, and tracking.

## Setup

Use Node 22.22.3+ and PostgreSQL 16. Install dependencies in the same operating system that runs the project (do not share Windows-installed `node_modules` with WSL).

```bash
npm install
npm --prefix dashboard install
cp .env.example .env
# Set DATABASE_URL, ANTHROPIC_API_KEY, applicant email, RESUME_PATH,
# and a random DASHBOARD_TOKEN of at least 24 characters.
npm run db:migrate
npm run dashboard:build
npm run run:once
npm run dashboard
```

Open http://127.0.0.1:3000 and enter your dashboard token. The server binds only to loopback. Keep it behind authenticated TLS if exposing it through a reverse proxy. API secrets stay on the server; the access token is held in browser memory only.

For a local PostgreSQL instance:

```bash
docker run --name job-agent-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=job_agent -p 127.0.0.1:5432:5432 -d postgres:16
```

The database must use UTF-8 encoding; job descriptions contain characters that legacy code pages such as WIN1252 cannot store. `db:migrate` refuses to run against a non-UTF-8 database. A native PostgreSQL install on Windows can default to WIN1252, so create the database explicitly:

```sql
CREATE DATABASE job_agent ENCODING 'UTF8' TEMPLATE template0;
```

`db:migrate` initializes a fresh database from committed migrations and applies later additive migrations such as the audit-table indexes. If you already created the original v1 tables, back up the database and review `npm run db:push` for the additive schema changes instead of running the fresh-install migration over those tables. Existing records without source identities must be rediscovered and reviewed before sending.

## Workflow

1. Fetch configured sources (Lever, Greenhouse, Infopark, Technopark, Cutshort, Hirist, company career pages) and record each fetch or failure for source health. Jobs from other sites can be added by hand.
2. Normalize URLs, descriptions, location, source identity, and content fingerprints; deduplicate and track activity. A listing that cannot be stored is audited without abandoning the rest of the board. Duplicates are audited once, and a closed listing that reappears returns to review.
3. Apply clear eligibility exclusions; retain skipped records with reasons.
4. Score using 60% deterministic evidence matching and 40% validated LLM semantic output, keeping confidence separate. Review visibility is independent of score: show every eligible Angular mention, including optional Angular and lower-scoring roles. Rank Angular + Node.js highest; keep Angular + .NET at lower priority with a gap; skip mandatory Java and jobs whose minimum required experience exceeds four years. Company technology catalogues and alternatives are not cumulative job requirements. Without LLM credentials, eligible jobs remain visible with an evidence score and a pending-semantic flag. Cached evaluations are versioned against the CV and matching policy.
5. Select two or three verified CV evidence IDs using the LLM. Render exact verified statements into a concise application message, preventing unsupported generated achievements.
6. Review score breakdown, confidence, strengths, gaps, source, full description, resume, draft, recipient, and screening responses in Angular. High scores with low confidence are flagged. Edit, skip (optionally flagging a false positive), override with a reason, or explicitly approve the current preview. The dashboard lists every reason approval is currently blocked.
7. Re-fetch the source, verify the description and destination have not changed, enforce guards and the daily cap, reserve delivery, and send through Gmail.
8. Record provider receipt and audit events; update Interview, Rejected, or Offer outcomes manually.

The evidence profile is now transcribed from the supplied **SHAJMIL VJ - Software Engineer.pdf**, including RxJS, NgRx, Standalone Components, Reactive Forms, AG Grid, Vitest, Angular TestBed, and GitHub Actions. Each skill/highlight includes its CV evidence. The profile retains the CV's 3+ years; the four-year application limit is a separate preference. PHP, Python, Java, .NET, and AI-coding-assistant experience are not claimed. Configure the matching PDF before sending.

## Commands

| Command | Purpose |
|---|---|
| `npm start` | Schedule discovery at 09:00 Asia/Kolkata; no immediate run by default |
| `npm run run:once` | One discovery/scoring/tailoring cycle |
| `npm run rescore` | Re-evaluate unsent automatic decisions against updated rules; preserve manual skips, overrides, and submissions; audit prior scores |
| `npm run dashboard` | Serve the Angular dashboard and authenticated API |
| `npm start -- --pending` | Print complete pending previews and approval versions |
| `npm start -- --apply ID --version VERSION` | Explicitly approve and send that reviewed preview |
| `npm start -- --skip ID` | Skip an unsent job |
| `npm run build` | Strict backend TypeScript validation |
| `npm test` | Workflow and safety regression tests |
| `npm run dashboard:build` | Type-check and bundle Angular |
| `npm run db:generate` | Generate migrations after schema changes |

Set `CRON_SCHEDULE=0 9,18 * * *` for an evening run, or `RUN_ON_STARTUP=true` for development startup discovery. Run scheduler and dashboard as separate processes.

## Sources

| Source | How it is read | Setting |
|---|---|---|
| Lever and Greenhouse boards | Official public JSON APIs | `LEVER_COMPANIES`, `GREENHOUSE_COMPANIES` |
| Infopark (Kochi, Thrissur, Cherthala) | Campus listing tables and job detail pages | `INFOPARK_ENABLED` |
| Technopark (Thiruvananthapuram) | Public listing endpoint and job detail pages | `TECHNOPARK_ENABLED` |
| Cutshort | Jobs sitemap filtered by keyword, JobPosting data on each job page | `CUTSHORT_KEYWORDS` |
| Hirist | Jobs sitemap filtered by keyword, each page rendered in Chrome or Edge | `HIRIST_KEYWORDS`, `HIRIST_MAX_JOBS` |
| Company career pages | JobPosting data on the page or its linked job pages, optionally rendered | `CAREER_PAGES`, `CAREER_PAGES_RENDER` |
| LinkedIn, Naukri, Indeed, anything else | **Add a job** in the dashboard | none |

Every non-API source checks robots.txt before each request, honours the site's Crawl-delay (Hirist asks for 10 seconds), waits at least one second between requests to a host, and identifies itself as `JobSearchAgent/2.0` instead of imitating a browser. Park portals are read completely, so a listing that disappears is closed. Park titles that are clearly not software roles, such as sales or HR, are counted but not opened. Sitemap sources read only the newest keyword-matching pages each run (`STRUCTURED_SOURCE_MAX_JOBS`) and never close listings on their own; re-verification before sending catches expired ones. Playwright runs only for Hirist and for career pages with `CAREER_PAGES_RENDER=true`, using an installed Chrome or Edge (`BROWSER_EXECUTABLE_PATH` overrides detection).

LinkedIn, Naukri and Indeed are not collected automatically. LinkedIn's robots.txt disallows all automated access and its user agreement prohibits it. Naukri's robots.txt blocks AI agents by name. Indeed's terms prohibit scraping. For listings you find there, open **Add a job** in the review queue and paste the link, company, title, location and full description. The job is deduplicated, filtered, scored and drafted like any other, and is applied to through its original link because it cannot be re-verified automatically.

The Greenhouse and Lever defaults were each found through job-board search on 2026-09-13 and verified to list Angular roles located in India. The placeholder slugs from the design document (`gadgeon`, `entri`, `zafin`, `soti`, `zeotap`) returned 404 on both platforms that day and are not configured. Board contents change daily, so defaults are a starting point, not a guarantee of matches.

Technopark publishes each company's website, so a careers mailbox on a Technopark listing is accepted only when its domain matches that website. For other sources the mailbox domain must spell the company's leading words. Personal recruiter addresses, common on Infopark, are never sent to automatically; those jobs are applied to through the listing.

Without model credentials, discovery, filtering and evidence scoring still run. Eligible jobs keep their evidence score and wait in **New** for semantic scoring instead of failing on every run. Invalid boards and unreachable sites are reported as source failures, and detail pages that could not be read are counted per source.

## Sending controls

`APPLICATION_SENDING_ENABLED=false` and `DIGEST_ENABLED=false` are the defaults. To use Gmail, configure `NOTIFY_GMAIL_ADDRESS`, `NOTIFY_GMAIL_APP_PASSWORD`, and `APPLICANT_EMAIL_ADDRESS`; digests also require `NOTIFY_RECIPIENT_ADDRESS`.

Every send requires a current preview version bound to the exact job, destination, draft, screening data, and PDF bytes. Sending additionally requires an active unchanged source listing, an application-context career mailbox with a matching company domain, no prior reservation, a waiting-for-approval status, and capacity under `MAX_APPLICATIONS_PER_DAY` (IST calendar day). Unsupported or uncertain recipients are blocked; use the source website manually. Score overrides never bypass delivery guards.

A PostgreSQL advisory lock serializes reservations across processes. A unique job constraint prevents duplicate delivery. SMTP delivery cannot be made atomic with a database transaction: ambiguous failures remain reserved as `Delivery uncertain` and are **never retried automatically**. Inspect Gmail/provider records before manually reconciling them. A crash after reservation also requires reconciliation. No live email is sent by tests.

## Scope and limitations

- API credentials, PostgreSQL, and a CV PDF are required for a complete live workflow. LLM or source failures are audited; the system does not pretend a fallback score is a semantic evaluation.
- ATS forms are opened for manual completion. The app sends only validated email applications. Automated inbox reply tracking and resume rewriting are not implemented.
- Screening questions can be entered in the review dashboard; ATS-specific question harvesting is not implemented. Only narrow verified factual questions are answered automatically: name, total experience, education, applicant email, and yes/no experience with a CV-listed skill. Per-skill durations and personal decisions ask the user; unlisted skills and sensitive questions remain unanswered.
- Bare “Remote” and “Remote, APAC” locations are marked unknown because they do not establish India eligibility. Regional listings such as “Remote, EMEA” or “Remote, US” are outside India. Undisclosed salary is not a hard rejection. Location and experience extraction use conservative heuristics.
- Token costs are estimates; configure the two per-million rate variables for your model's actual pricing. Cache hits incur zero new model tokens.
- Activity shows totals, source health, skip reasons, runs, delivery records, recent events, false-positive feedback, and estimated costs. Failures carry a retryable or permanent category, and blocked send attempts are audited. It is not an external monitoring/alerting service.
- The Angular dashboard uses a small esbuild/JIT bundle, Angular 22 signals, and zoneless change detection. Security-patched Angular, Drizzle, cron, and Nodemailer releases replace the older versions named in the design document. Application dependencies are unrelated to candidate CV claims.

### Updating existing results

After this CV/preference update, run `npm run rescore` with your database environment configured, then refresh the dashboard. This reconsiders previously low-scoring Angular jobs, including the Techversant Web Developer listing. That role stays visible at lower priority: PHP/Python proficiency is required, Angular is optional, and mandatory AI-assistant usage remains unverified. No application is sent by rescore.

### Finding more results and LinkedIn/Naukri imports

The dashboard now searches full descriptions as well as titles and companies. New installations show every source by default; existing saved source choices remain intact. Use **Reset filters & show all sources** to restore visibility. **Recommended** includes eligible `New` jobs awaiting LLM scoring as well as jobs waiting for approval; it does not impose a 75-point visibility threshold. Use **Re-evaluate existing jobs** after changing matching rules to reconsider stored automatic skips. This does not send applications.

The **Find and import Naukri / LinkedIn jobs** panel offers platform search links, single-job import, and bulk JSON import. Imported records retain `linkedin` or `naukri` as their source and enter the same normalization, deduplication, filtering, scoring, and review workflow. Supply full descriptions, not search-result snippets. Up to 100 records are validated before a batch is written. If an external service fails during processing, retrying the batch deduplicates records already stored.

For scheduled ingestion of your own exported data, set `JOB_BOARD_IMPORT_FILES` to comma-separated JSON file paths. Each file uses this format:

```json
[{"applyUrl":"https://www.linkedin.com/jobs/view/123","companyName":"Example","roleTitle":"Software Engineer","locationText":"Kochi","jobDescription":"Paste the complete job description here (at least 100 characters)."}]
```

These are import integrations, not automatic LinkedIn/Naukri crawlers. No account cookies or private APIs are used. Imported listings cannot be automatically reverified for email submission; apply through their original listing. LinkedIn's published crawler rules disallow this agent; no live Naukri collection has been verified. Search shortcuts and imports do not themselves increase stored job counts until jobs are imported.
