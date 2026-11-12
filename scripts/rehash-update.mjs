// Signing changes the installer's bytes, so latest.yml needs the signed file's size and sha512.
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";

const [ymlPath, exePath] = process.argv.slice(2);
const sha = createHash("sha512").update(readFileSync(exePath)).digest("base64");
const size = statSync(exePath).size;
const out = readFileSync(ymlPath, "utf8")
  .replace(/^(\s*-?\s*sha512:\s*).*$/gm, `$1${sha}`)
  .replace(/^(\s*size:\s*).*$/gm, `$1${size}`);
writeFileSync(ymlPath, out);
console.log(`${ymlPath}: ${size} bytes, sha512 ${sha.slice(0, 16)}…`);
