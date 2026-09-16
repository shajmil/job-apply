import 'dotenv/config';
export function positiveInt(name: string, fallback: number): number {
 const n = Number(process.env[name] ?? fallback);
 if (!Number.isSafeInteger(n) || n < 1) throw new Error(`Invalid ${name}`);
 return n;
}
export const env = {
 databaseUrl: process.env.DATABASE_URL,
 model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
 sendingEnabled: () => process.env.APPLICATION_SENDING_ENABLED === 'true',
 dailyLimit: () => positiveInt('MAX_APPLICATIONS_PER_DAY', 10),
 resumePath: () => process.env.RESUME_PATH || process.env.RESUME_PDF_PATH,
};
