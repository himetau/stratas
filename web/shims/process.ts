// The core reads process.platform and process.env (launcher folders). Imported first so they exist in the browser
const g = globalThis as { process?: unknown };
if (!g.process) g.process = { platform: "linux", env: {}, versions: {}, argv: [] };
export {};
