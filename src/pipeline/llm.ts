import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { retry } from '../utils/retry.js';
export interface LlmUsage { input: number; output: number; cost: number }
// Raised when the model responded but its output is unusable. Carries usage so spend is still recorded.
export class LlmOutputError extends Error {
 readonly permanent = true;
 constructor(message: string, readonly usage: LlmUsage) { super(message); }
}
export function usageCost(input: number, output: number): number {
 return (input*Number(process.env.LLM_INPUT_USD_PER_MILLION??3)+output*Number(process.env.LLM_OUTPUT_USD_PER_MILLION??15))/1e6;
}
// Accepts a bare JSON object or one wrapped in prose/code fences; never evaluates anything else.
export function parseModelJson(text: string): unknown {
 const fenced=text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text;
 const start=fenced.indexOf('{'), end=fenced.lastIndexOf('}');
 if(start<0||end<=start) throw new SyntaxError('Model response contained no JSON object');
 return JSON.parse(fenced.slice(start,end+1));
}
let client: Anthropic | undefined;
export async function ask(system: string, data: unknown): Promise<LlmUsage & {value: unknown}> {
 client??=new Anthropic({apiKey:process.env.ANTHROPIC_API_KEY});
 const response=await retry(()=>client!.messages.create({model:env.model,max_tokens:1200,system,messages:[{role:'user',content:JSON.stringify(data)}]}));
 const input=response.usage.input_tokens,output=response.usage.output_tokens,usage={input,output,cost:usageCost(input,output)};
 const stop=response.stop_reason as string|null;
 if(stop!=='end_turn'&&stop!=='stop_sequence') throw new LlmOutputError(`Model stopped with ${stop}`,usage);
 const text=response.content.filter(b=>b.type==='text').map(b=>(b as {text:string}).text).join('');
 try { return {value:parseModelJson(text),...usage}; }
 catch(e) { throw new LlmOutputError(`Invalid model JSON: ${e instanceof Error?e.message:String(e)}`,usage); }
}
