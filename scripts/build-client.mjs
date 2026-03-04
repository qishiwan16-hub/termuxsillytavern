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
  minify: true,
  sourcemap: false,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
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
  throw new Error("客户端构建失败：未生成 JS 产物");
}

const html = [
  "<!doctype html>",
  '<html lang="zh-CN">',
  "  <head>",
  '    <meta charset="UTF-8" />',
  '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
  "    <title>ST 资源管理器</title>",
  cssOutput ? `    <link rel="stylesheet" href="/assets/${path.basename(cssOutput)}" />` : "",
  `    <script type="module" src="/assets/${path.basename(jsOutput)}"></script>`,
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

console.log("客户端构建完成:", {
  js: path.basename(jsOutput),
  css: cssOutput ? path.basename(cssOutput) : null
});
