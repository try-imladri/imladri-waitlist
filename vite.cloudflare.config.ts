import vinext from "vinext";
import { defineConfig } from "vite";

// Standalone Cloudflare build: no Sites authentication, connector preview,
// hosting-manifest copy, or OpenAI-hosted runtime is involved.
export default defineConfig(async () => {
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= "false";
  process.env.WRANGLER_SEND_METRICS ??= "false";
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  return {
    server: { host: "127.0.0.1" },
    plugins: [
      vinext(),
      cloudflare({
        configPath: "wrangler.cloudflare.json",
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        persistState: { path: ".wrangler/cloudflare-state" },
      }),
    ],
  };
});
