import { defineConfig } from "vite";

/**
 * Bundles the Express API into a single ESM file (dist/server/index.js).
 * Running from source would require tsx in production, so the server is
 * compiled ahead of time instead.
 */
export default defineConfig({
  build: {
    ssr: "src/server/index.ts",
    outDir: "dist/server",
    emptyOutDir: true,
    target: "node22",
    minify: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        entryFileNames: "index.js",
        format: "es",
      },
    },
  },
});
