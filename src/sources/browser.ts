import { existsSync } from 'node:fs';
import type { Browser } from 'playwright-core';
import { USER_AGENT } from './http.js';
const candidates=[
 process.env.BROWSER_EXECUTABLE_PATH,
 'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe',
 '/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser',
 '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
];
// Playwright is used only for sources whose job data is loaded by page scripts. It drives an installed Chrome or Edge.
export async function withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
 const { chromium }=await import('playwright-core');
 const executablePath=candidates.find(p=>p&&existsSync(p));
 if(!executablePath) throw Object.assign(new Error('No Chrome or Edge found for browser-rendered sources; set BROWSER_EXECUTABLE_PATH'),{status:424});
 const browser=await chromium.launch({executablePath,headless:true});
 try { return await fn(browser); } finally { await browser.close(); }
}
export async function newAgentContext(browser: Browser) { return browser.newContext({userAgent:`${USER_AGENT} HeadlessChrome`}); }
