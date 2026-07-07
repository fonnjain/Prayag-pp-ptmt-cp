import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "dist/index.js",
  external: [
    "puppeteer",
    "exceljs",
    "pino",
    "pino-http",
    "thread-stream",
    "pg-native",
    "*.node",
  ],
});

console.log("Build complete → dist/index.js");
