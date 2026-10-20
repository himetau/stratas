// esbuild bundle for Electron main, preload and the CLI
import { build } from "esbuild";

const common = { bundle: true, platform: "node", target: "node24", format: "cjs", sourcemap: true, logLevel: "warning", loader: { ".json": "json" } };

await Promise.all([
  build({ ...common, entryPoints: ["electron/main.ts"], outfile: "dist/electron/main.cjs", external: ["electron", "electron-updater"] }),
  build({ ...common, entryPoints: ["electron/preload.ts"], outfile: "dist/electron/preload.cjs", external: ["electron"] }),
  build({ ...common, entryPoints: ["scripts/cli.ts"], outfile: "dist/cli.cjs" }),
]);
