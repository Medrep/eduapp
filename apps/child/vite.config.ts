import { defineConfig } from "vite";
import { buildViewerWrapper, shellConfig } from "../../scripts/shell-config.ts";
import { localMockGateway } from "../../scripts/mock-device-api.ts";
import { pwaWorker } from "../../scripts/pwa-worker.ts";
import { browserBackendConfig } from "../../scripts/browser-backend-config.ts";

const wrapper = buildViewerWrapper("child");

export default defineConfig(({ mode }) => {
  const { origin } = browserBackendConfig(mode, "child");
  const shell = shellConfig(4173, wrapper, origin);
  return {
    ...shell,
    envPrefix: [],
    define: { ...shell.define, __SUPABASE_ORIGIN__: JSON.stringify(origin) },
    server: {
      ...shell.server,
      fs: { deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/fixtures/**"] },
    },
    plugins: [...shell.plugins, ...(origin ? [] : [localMockGateway(4173)]),
      pwaWorker("src/sw.ts", wrapper, ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"])],
  };
});
