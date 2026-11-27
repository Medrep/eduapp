from pathlib import Path
import sys

specs = Path(sys.argv[1]) / "tests/browser"
fragment = Path(sys.argv[2]).read_text()
source = (specs / "catalog.spec.ts").read_text()
assert 'const origin = "http://127.0.0.1:4173";' in source
source = source.replace('const origin = "http://127.0.0.1:4173";', 'let origin = "";', 1)
fragment = fragment.replace("  let context = await launch();", """
  const { fileURLToPath } = await import("node:url");
  const { preview } = await import("vite");
  const { buildViewerWrapper, shellConfig } = await import("../../scripts/shell-config.ts");
  const root = fileURLToPath(new URL("../../apps/child/", import.meta.url));
  const server = await preview({ configFile: false, root, ...shellConfig(0, buildViewerWrapper("child")) });
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Missing isolated loopback preview");
  origin = `http://127.0.0.1:${address.port}`;
  let context = await launch();
""")
fragment = fragment.replace("    await rm(profile, { force: true, recursive: true });", """
    await server.close();
    await rm(profile, { force: true, recursive: true });""")
(specs / "crash-s2-diagnostic.spec.ts").write_text(source + fragment)
