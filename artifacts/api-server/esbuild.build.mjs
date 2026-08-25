import * as esbuild from "esbuild";
import { execSync } from "node:child_process";

function git(command) {
  return execSync(command, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function resolveBuildCommitSha() {
  if (process.env.NODE_ENV === "production") {
    try {
      const remoteLine = git("git ls-remote origin refs/heads/main");
      const remoteSha = remoteLine.split(/\s+/)[0];
      if (remoteSha) return remoteSha;
    } catch {
      // Fall through to an explicitly injected SHA so local production
      // probes can still explain the failure in the assertion below.
    }
  }
  const injected = process.env.GIT_COMMIT?.trim();
  if (injected) return injected;
  try {
    // Publishing happens after the GitHub push. Prefer the fetched remote
    // branch so the deployed health identity resolves to a real remote commit,
    // not to the local commit object that the GitHub API may have rewritten.
    if (process.env.NODE_ENV === "production") return git("git rev-parse origin/main");
    return git("git rev-parse HEAD");
  } catch {
    return "(unknown)";
  }
}

function assertProductionShaResolvesRemotely(sha) {
  if (process.env.NODE_ENV !== "production") return;
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error(`Production build requires a full remote commit SHA, got ${JSON.stringify(sha)}`);
  }
  try {
    const remoteLine = git("git ls-remote origin refs/heads/main");
    const remoteSha = remoteLine.split(/\s+/)[0];
    if (remoteSha && remoteSha !== sha) {
      throw new Error(`origin/main is ${remoteSha || "(missing)"}, not ${sha}`);
    }
    if (remoteSha) {
      // Publish checkouts can be shallow and omit the remote commit object.
      // The successful ls-remote equality check is authoritative in that case.
      return;
    }

    const objectType = git(`git cat-file -t ${sha}`);
    if (objectType !== "commit") {
      throw new Error(`git cat-file -t ${sha} returned ${JSON.stringify(objectType)}`);
    }
  } catch (error) {
    throw new Error(
      `Refusing production build: injected commit ${sha} does not resolve to origin/main. ${String(error)}`,
    );
  }
}

const buildCommitSha = resolveBuildCommitSha();
assertProductionShaResolvesRemotely(buildCommitSha);

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
    "process.env.GIT_COMMIT": JSON.stringify(buildCommitSha),
  },
});

console.log("Build complete → dist/index.cjs");
