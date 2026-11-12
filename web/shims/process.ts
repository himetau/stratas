// The core reads process.platform and process.env when it loads, so this must be imported first.
const g = globalThis as { process?: unknown };
if (!g.process) {
  g.process = { platform: "linux", env: {}, versions: {}, argv: [] };
}
export {};
