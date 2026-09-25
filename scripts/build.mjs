import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "vite";

const root = resolve(import.meta.dirname, "..");
const outDir = resolve(root, "dist");
const watch = process.argv.includes("--watch") ? {} : undefined;

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

await build({
  configFile: false,
  root,
  publicDir: false,
  build: {
    outDir,
    emptyOutDir: false,
    sourcemap: false,
    target: "chrome120",
    watch,
    rollupOptions: {
      input: {
        popup: resolve(root, "popup.html"),
        options: resolve(root, "options.html"),
        background: resolve(root, "src/entries/background.ts")
      },
      output: {
        entryFileNames: (chunk) => chunk.name === "background"
          ? "background.js"
          : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});

await build({
  configFile: false,
  root,
  publicDir: false,
  build: {
    outDir,
    emptyOutDir: false,
    sourcemap: false,
    target: "chrome120",
    watch,
    minify: false,
    lib: {
      entry: resolve(root, "src/entries/content.ts"),
      name: "CJFontFallbackContent",
      formats: ["iife"],
      fileName: () => "content.js"
    }
  }
});

await Promise.all([
  cp(resolve(root, "manifest.json"), resolve(outDir, "manifest.json")),
  cp(resolve(root, "LICENSE"), resolve(outDir, "LICENSE")),
  cp(resolve(root, "icons"), resolve(outDir, "icons"), { recursive: true }),
  cp(resolve(root, "_locales"), resolve(outDir, "_locales"), { recursive: true })
]);
