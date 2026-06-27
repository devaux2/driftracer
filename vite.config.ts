import { defineConfig } from "vite";
import { execSync } from "node:child_process";

// Stamp the build with the short git commit hash so the running version is
// visible in-game (shown on the splash). Falls back to "dev" outside git.
const buildId = (() => {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "dev";
  }
})();

export default defineConfig({
  // Relative base so the build works under any path (e.g. GitHub Pages'
  // https://<user>.github.io/driftracer/) without hardcoding the repo name.
  base: "./",
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: "es2020",
    sourcemap: true,
  },
});
