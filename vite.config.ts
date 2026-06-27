import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so the build works under any path (e.g. GitHub Pages'
  // https://<user>.github.io/driftracer/) without hardcoding the repo name.
  base: "./",
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: "es2020",
    sourcemap: true,
  },
});
