import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";

const root = new URL("./", import.meta.url);
await mkdir(new URL("netlify/public/", root), { recursive: true });
await copyFile(new URL("setup.html", root), new URL("netlify/public/index.html", root));
await copyFile(new URL("setup.js", root), new URL("netlify/public/setup.js", root));
const pem = await readFile(new URL("certs/geotrust-cn-intermediate.pem", root), "utf8");
await writeFile(new URL("netlify/geotrust-certificate.mjs", root), `export default ${JSON.stringify(pem)};\n`);
await writeFile(new URL("netlify/public/_headers", root), `/*
  Cache-Control: no-store
  X-Content-Type-Options: nosniff
  Content-Security-Policy: default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'
`);
console.log("Prepared relay diagnostic page and bundled GeoTrust intermediate");
