import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const shim = (file: string) => fromRoot(`./web/shims/${file}`);

/** Serves the README images in docs/ and the icons in packaging/ to the dev server.
 *  The landing page uses them, and they sit outside web/. */
function outsideAssets(): Plugin {
  const types: Record<string, string> = { ".png": "image/png", ".svg": "image/svg+xml" };
  return {
    name: "stratas-outside-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? "").split("?")[0];
        if (!/^\/(docs\/readme|packaging)\/[\w.-]+\.(png|svg)$/.test(path)) {
          return next();
        }
        readFile(new URL(`.${path}`, import.meta.url)).then(
          (b) => {
            res.setHeader("content-type", types[extname(path)]);
            res.end(b);
          },
          () => next(),
        );
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
    rollupOptions: {
      input: {
        main: fromRoot("./web/index.html"),
        app: fromRoot("./web/app/index.html"),
      },
    },
  },
});
