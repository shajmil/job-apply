import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist',{recursive:true});
await build({entryPoints:['src/main.ts'],bundle:true,outfile:'dist/main.js',format:'esm',minify:true});
await copyFile('src/index.html','dist/index.html');
await copyFile('src/styles.css','dist/styles.css');
