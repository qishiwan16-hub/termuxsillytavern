import fs from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const rootDir = process.cwd();
const clientDir = path.resolve(rootDir, "dist/client");
const assetsDir = path.resolve(clientDir, "assets");

await fs.rm(clientDir, { recursive: true, force: true });
await fs.mkdir(assetsDir, { recursive: true });

const result = await build({
  entryPoints: [path.resolve(rootDir, "src/main.tsx")],
  bundle: true,
  splitting: false,
  // Keep output readable to avoid giant single-line bundles that can break older WebViews.
  minify: false,
  sourcemap: false,
  format: "iife",
  globalName: "STResourceManagerApp",
  platform: "browser",
  // Older Android emulators may fail to parse newer syntax.
  target: ["es2017"],
  outdir: assetsDir,
  entryNames: "index",
  assetNames: "index",
  metafile: true,
  logLevel: "info"
});

const outputs = Object.keys(result.metafile.outputs);
const jsOutput = outputs.find((item) => item.endsWith(".js"));
const cssOutput = outputs.find((item) => item.endsWith(".css"));

if (!jsOutput) {
  throw new Error("Client build failed: missing JS output.");
}

const html = [
  "<!doctype html>",
  '<html lang="zh-CN">',
  "  <head>",
  '    <meta charset="UTF-8" />',
  '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
  "    <title>ST Resource Manager</title>",
  cssOutput ? `    <link rel="stylesheet" href="/assets/${path.basename(cssOutput)}" />` : "",
  `    <script src="/assets/${path.basename(jsOutput)}" defer></script>`,
  "  </head>",
  "  <body>",
  '    <div id="root"></div>',
  "  </body>",
  "</html>",
  ""
]
  .filter(Boolean)
  .join("\n");

await fs.writeFile(path.resolve(clientDir, "index.html"), html, "utf8");

console.log("Client build complete:", {
  js: path.basename(jsOutput),
  css: cssOutput ? path.basename(cssOutput) : null
});
