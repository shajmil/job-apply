import { randomUUID } from 'node:crypto';
import { database } from '../db/client.js';
import { agentEvents } from '../db/schema.js';
import { errorCategory } from '../utils/retry.js';
export function log(event: string, metadata: Record<string, unknown> = {}) { console.log(JSON.stringify({time:new Date().toISOString(),event,...metadata})); }
export async function audit(eventType: string, message: string, jobId?: string, metadata?: Record<string, unknown>, runId?: string) {
 log(eventType,{jobId,runId,message,...metadata});
 await database.insert(agentEvents).values({id:randomUUID(),eventType,message,jobId,metadata,runId});
}
// Query-builder errors wrap the driver error and embed the full SQL with row data; the driver message is what matters.
export function errorMessage(error: unknown): string {
 const cause=(error as {cause?:unknown})?.cause;
 const message=cause instanceof Error?cause.message:error instanceof Error?error.message:String(error);
 return message.split(String.fromCharCode(0)).join('').slice(0,1000);
}
// Records a failure with its retryable/permanent category so operators can tell outages from bad data.
// Writing the failure must never raise a second error that hides the first one.
export async function auditError(eventType: string, error: unknown, jobId?: string, metadata: Record<string, unknown> = {}, runId?: string) {
 try { await audit(eventType,errorMessage(error),jobId,{...metadata,errorCategory:errorCategory(error)},runId); }
 catch(writeError) { console.error(JSON.stringify({time:new Date().toISOString(),event:'AUDIT_WRITE_FAILED',eventType,jobId,runId,message:errorMessage(error),writeError:errorMessage(writeError)})); }
}
