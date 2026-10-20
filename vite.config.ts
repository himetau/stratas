import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { rankedArt, rankedAssets, rankIcons } from "./src/core/ranks";
import { cachedOldArt, fetchOldArt, oldArtData } from "./src/core/oldart";
import { skinPng } from "./src/core/skins";

/** browser preview only: skins, rank icons and Ranked's background, served the way the app's main process would */
function devAssets(): Plugin {
  const modJar = () => {
    try {
      const snap = JSON.parse(readFileSync("src/ui/dev/snapshot.json", "utf8")) as { state: { instances?: string[]; instance?: { modJar?: string } } };
      for (const inst of [...(snap.state.instances ?? []), snap.state.instance?.modJar ? join(snap.state.instance.modJar, "../..") : ""]) {
        if (!inst) continue;
        try { const jar = readdirSync(join(inst, "mods")).find((f) => /^mcsrranked-.*\.jar$/.test(f)); if (jar) return join(inst, "mods", jar); } catch { /* next */ }
      }
    } catch { /* no snapshot */ }
    return null;
  };
  return {
    name: "stratas-dev-assets",
    configureServer(server) {
      server.middlewares.use("/__dev/ranked", (_req, res) => {
        const jar = modJar();
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ icons: rankIcons(jar), ...rankedAssets(jar) }));
      });
      const oldDir = "node_modules/.cache/stratas-oldart";
      server.middlewares.use("/__dev/oldart", (req, res) => {
        const go = new URL(req.url ?? "", "http://x").searchParams.has("fetch");
        res.setHeader("content-type", "application/json");
        void (go ? fetchOldArt(oldDir, console.log) : Promise.resolve(cachedOldArt(oldDir))).then((l) => res.end(JSON.stringify(l)), (e) => { res.statusCode = 500; res.end(JSON.stringify(String(e))); });
      });
      server.middlewares.use("/__dev/art", (req, res) => {
        const key = new URL(req.url ?? "", "http://x").searchParams.get("key") ?? "";
        const url = key.startsWith("old:") ? oldArtData(oldDir, key) : rankedArt(modJar(), key);
        if (!url) { res.statusCode = 404; res.end(); return; }
        res.end(url);
      });
      server.middlewares.use("/__dev/skin", (req, res) => {
        const q = new URL(req.url ?? "", "http://x").searchParams;
        void skinPng({ uuid: q.get("uuid"), name: q.get("name") }, "node_modules/.cache/stratas-skins").then((png) => {
          if (!png) { res.statusCode = 404; res.end(); return; }
          res.setHeader("content-type", "image/png");
          res.end(png);
        });
      });
    },
  };
}

export default defineConfig({
  root: "src/ui",
  base: "./",
  plugins: [devAssets()],
  build: { outDir: "../../dist/ui", emptyOutDir: true, target: "chrome130" },
  test: { root: ".", include: ["test/**/*.test.ts"] },
});
