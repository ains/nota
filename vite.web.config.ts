import { resolve } from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Standalone browser dev server for the renderer (no Electron). Used by CI to
// render the app in a real browser and drive it via the `window.__nota_dev`
// injection hook, which is only exposed while `import.meta.env.DEV` is true.
export default defineConfig({
  root: resolve("src/renderer"),
  plugins: [react()],
  resolve: {
    alias: {
      "@renderer": resolve("src/renderer/src"),
      "@shared": resolve("src/shared"),
    },
  },
  server: { port: 5199, strictPort: true },
});
