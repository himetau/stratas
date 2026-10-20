// After the Windows installer is signed it's a different file, so fix its size and sha512 in latest.yml
// Usage: node scripts/rehash-update.mjs release/latest.yml release/Stratas-Setup.exe
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";

const [yml, exe] = process.argv.slice(2);
const sha = createHash("sha512").update(readFileSync(exe)).digest("base64"), size = statSync(exe).size;
const out = readFileSync(yml, "utf8")
  .replace(/^(\s*-?\s*sha512:\s*).*$/gm, `$1${sha}`)
  .replace(/^(\s*size:\s*).*$/gm, `$1${size}`);
writeFileSync(yml, out);
console.log(`${yml}: ${size} bytes, sha512 ${sha.slice(0, 16)}…`);
