export type ErrorCategory = 'retryable' | 'permanent';
// Network failures, timeouts, rate limits and 5xx responses are transient; everything else is permanent.
export function errorCategory(e: unknown): ErrorCategory {
 const status=(e as {status?:number})?.status;
 if(status===undefined) return e instanceof SyntaxError ? 'permanent' : (e as {permanent?:boolean})?.permanent ? 'permanent' : 'retryable';
 return status===408 || status===429 || status>=500 ? 'retryable' : 'permanent';
}
export async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
 for (let n=0;;n++) { try { return await fn(); } catch(e) {
 if(n >= attempts-1 || errorCategory(e)==='permanent') throw e;
 await new Promise(r=>setTimeout(r, 250 * 2**n + Math.random()*100));
 }}
}
export async function fetchJson(url: string): Promise<unknown> {
 return retry(async()=>{ const r=await fetch(url,{signal:AbortSignal.timeout(20000)});
 if(!r.ok) throw Object.assign(new Error(`Source HTTP ${r.status}`),{status:r.status});
 try { return await r.json(); } catch { throw Object.assign(new Error('Malformed source JSON'),{status:422}); }
 });
}
