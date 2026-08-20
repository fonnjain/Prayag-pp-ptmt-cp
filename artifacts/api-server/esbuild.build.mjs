import * as esbuild from "esbuild";
import { execSync } from "node:child_process";

function resolveBuildCommitSha() {
  const injected = process.env.GIT_COMMIT?.trim();
  if (injected) return injected;
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "(unknown)";
  }
}

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
  define: {
    "process.env.GIT_COMMIT": JSON.stringify(resolveBuildCommitSha()),
  },
});

console.log("Build complete → dist/index.cjs");
