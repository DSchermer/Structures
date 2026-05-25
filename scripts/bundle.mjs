// Combines the Vite build output (app/dist) with the Pages Functions
// directory (functions/) into a single folder (dist/) that Dylan can
// drag-and-drop into the Cloudflare Pages "Upload assets" UI.
//
// Cloudflare Pages picks up `functions/` at the root of the uploaded
// directory and turns each file into a Pages Function automatically.

import { rm, mkdir, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = path.join(root, 'dist');
const staticSrc = path.join(root, 'app', 'dist');
const functionsSrc = path.join(root, 'functions');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(staticSrc, out, { recursive: true });
await cp(functionsSrc, path.join(out, 'functions'), { recursive: true });

console.log(`Bundle ready: ${out}`);
console.log(`Drag the CONTENTS of this folder into Cloudflare Pages → Create deployment → Upload assets.`);
