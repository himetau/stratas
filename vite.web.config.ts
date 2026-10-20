// The website: a landing page (web/index.html) and the app's pages running in the browser (web/app/)
// The core stays as it is, its node: imports get browser stand-ins from web/shims
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const shim = (f: string) => fileURLToPath(new URL(`./web/shims/${f}`, import.meta.url));

/** The landing page uses the README's images from docs/ and the icons in packaging/. The build bundles them,
 *  the dev server needs to be shown where they are since they sit outside web/ */
function outsideAssets(): Plugin {
  const types: Record<string, string> = { ".png": "image/png", ".svg": "image/svg+xml" };
  return {
    name: "stratas-outside-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? "").split("?")[0];
        if (!/^\/(docs\/readme|packaging)\/[\w.-]+\.(png|svg)$/.test(path)) return next();
        readFile(new URL(`.${path}`, import.meta.url)).then((b) => { res.setHeader("content-type", types[extname(path)]); res.end(b); }, () => next());
      });
    },
  };
}

export default defineConfig({
  plugins: [outsideAssets()],
  root: "web",
  base: "./",
  publicDir: "public",
  resolve: {
    alias: {
      "node:fs": shim("fs.ts"),
      "node:sqlite": shim("sqlite.ts"),
      "node:zlib": shim("zlib.ts"),
      "node:os": shim("os.ts"),
      "node:path": "path-browserify",
      "node:events": "events",
    },
  },
  server: { fs: { allow: [".."] } },
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: { input: { main: fileURLToPath(new URL("./web/index.html", import.meta.url)), app: fileURLToPath(new URL("./web/app/index.html", import.meta.url)) } },
  },
});
