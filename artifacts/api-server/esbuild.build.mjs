import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/index.cjs",
  external: [
    "puppeteer",
    "exceljs",
    "pg-native",
    "*.node",
  ],
});

console.log("Build complete → dist/index.js");
