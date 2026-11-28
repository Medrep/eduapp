import { defineConfig } from "vite";
import { buildViewerWrapper, shellConfig } from "../../scripts/shell-config.ts";
import { pwaWorker } from "../../scripts/pwa-worker.ts";
import { browserBackendConfig } from "../../scripts/browser-backend-config.ts";

const wrapper = buildViewerWrapper("admin");

export default defineConfig(({ mode }) => {
  const { origin, publishableKey } = browserBackendConfig(mode, "admin");
  const shell = shellConfig(4174, wrapper, origin);
  return {
    ...shell,
    envPrefix: [],
    define: {
      ...shell.define,
      __SUPABASE_ORIGIN__: JSON.stringify(origin),
      __ADMIN_PUBLISHABLE_KEY__: JSON.stringify(publishableKey),
    },
    plugins: [...shell.plugins, pwaWorker("src/sw.ts", wrapper, [
        "/", "/icons/bright-pages.svg", "/favicon.svg", "/favicon.ico"
      ])],
  };
});
