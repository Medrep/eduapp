import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build, type Plugin } from "vite";
import type { ViewerWrapper } from "../packages/contracts/src/viewer-wrapper.ts";

async function compileWorker(entry: string, assets: string[], revision: string, wrapper: ViewerWrapper) {
  const result = await build({
    configFile: false,
    publicDir: false,
    logLevel: "error",
    define: {
      __SHELL_ASSETS__: JSON.stringify(assets),
      __SHELL_REVISION__: JSON.stringify(revision),
      __VIEWER_WRAPPER__: JSON.stringify(wrapper),
    },
    build: {
      write: false,
      minify: false,
      target: "es2022",
      lib: { entry, name: "MojaNaukaWorker", formats: ["iife"] },
    },
  });
  const output = Array.isArray(result) && result.length === 1 ? result[0] : result;
  if (!output || !("output" in output)) {
    throw new Error("Expected one classic Service Worker script.");
  }
  const [chunk] = output.output;
  if (output.output.length !== 1 || chunk?.type !== "chunk") {
    throw new Error("Service Worker must be a self-contained script.");
  }
  return chunk.code;
}

export function pwaWorker(entryFile: string, wrapper: ViewerWrapper, shellAssets: string[]): Plugin {
  const entry = resolve(entryFile);
  return {
    name: "moja-nauka-pwa-worker",
    configureServer(server) {
      server.watcher.add(entry);
      server.middlewares.use(async (request, response, next) => {
        if (request.url?.split("?")[0] !== "/sw.js") {
          next();
          return;
        }
        try {
          response.setHeader("Content-Type", "text/javascript; charset=utf-8");
          response.setHeader("Cache-Control", "no-cache");
          response.end(await compileWorker(entry, [wrapper.path], "development", wrapper));
        } catch (error) {
          next(error);
        }
      });
    },
    async writeBundle(_options, bundle) {
      // HTML has been emitted by Vite and public assets have already been copied.
      const precache = [...shellAssets, ...Object.keys(bundle).map((file) => `/${file}`)];
      const hash = createHash("sha256");
      for (const name of Object.keys(bundle).sort()) {
        const file = bundle[name];
        if (file) {
          hash.update(name).update(file.type === "asset" ? file.source : file.code);
        }
      }
      if (shellAssets.length) {
        for (const name of shellAssets.filter((asset) => asset !== "/")) {
          hash.update(name).update(await readFile(resolve("public", name.slice(1))));
        }
      }
      const script = await compileWorker(entry, precache, hash.digest("hex").slice(0, 24), wrapper);
      const output = _options.dir ?? (_options.file ? resolve(_options.file, "..") : "dist");
      await writeFile(resolve(output, "sw.js"), script);
    },
  };
}
