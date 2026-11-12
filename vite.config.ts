import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { rankedArt, rankedAssets, rankIcons } from "./src/core/ranks";
import { cachedOldArt, fetchOldArt, oldArtData } from "./src/core/oldart";
import { skinPng } from "./src/core/skins";

const OLD_ART_DIR = "node_modules/.cache/stratas-oldart";
const SKINS_DIR = "node_modules/.cache/stratas-skins";

type SnapshotState = { instances?: (string | { path: string })[]; instance?: { modJar?: string } };

function snapshotInstances(): string[] {
  try {
    const snap = JSON.parse(readFileSync("src/ui/dev/snapshot.json", "utf8")) as {
      state: SnapshotState;
    };
    const paths = (snap.state.instances ?? []).map((i) => (typeof i === "string" ? i : i.path));
    const modJar = snap.state.instance?.modJar;
    return modJar ? [...paths, join(modJar, "../..")] : paths;
  } catch {
    return [];
  }
}

function rankedModJar(instance: string): string | null {
  try {
    const jar = readdirSync(join(instance, "mods")).find((f) => /^mcsrranked-.*\.jar$/.test(f));
    return jar ? join(instance, "mods", jar) : null;
  } catch {
    return null;
  }
}

function modJar(): string | null {
  for (const instance of snapshotInstances()) {
    const jar = rankedModJar(instance);
    if (jar) {
      return jar;
    }
  }
  return null;
}

function queryOf(url: string | undefined): URLSearchParams {
  return new URL(url ?? "", "http://x").searchParams;
}

function artData(key: string): string | null {
  if (key.startsWith("old:")) {
    return oldArtData(OLD_ART_DIR, key);
  }
  if (key.startsWith("custom:")) {
    return null;
  }
  return rankedArt(modJar(), key);
}

/** Serves skins, rank icons and Ranked's art to the browser preview, as the app's main process would. */
function devAssets(): Plugin {
  return {
    name: "stratas-dev-assets",
    configureServer(server) {
      server.middlewares.use("/__dev/ranked", (_req, res) => {
        const jar = modJar();
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ icons: rankIcons(jar), ...rankedAssets(jar) }));
      });
      server.middlewares.use("/__dev/oldart", (req, res) => {
        res.setHeader("content-type", "application/json");
        const list = queryOf(req.url).has("fetch")
          ? fetchOldArt(OLD_ART_DIR, console.log)
          : Promise.resolve(cachedOldArt(OLD_ART_DIR));
        void list.then(
          (l) => res.end(JSON.stringify(l)),
          (e) => {
            res.statusCode = 500;
            res.end(JSON.stringify(String(e)));
          },
        );
      });
      server.middlewares.use("/__dev/art", (req, res) => {
        const url = artData(queryOf(req.url).get("key") ?? "");
        if (!url) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.end(url);
      });
      server.middlewares.use("/__dev/skin", (req, res) => {
        const q = queryOf(req.url);
        void skinPng({ uuid: q.get("uuid"), name: q.get("name") }, SKINS_DIR).then((png) => {
          if (!png) {
            res.statusCode = 404;
            res.end();
            return;
          }
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
