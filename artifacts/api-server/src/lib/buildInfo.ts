import { execSync } from "child_process";

/**
 * SHA of the git commit that produced this running process.
 * Computed once at module load (both dev tsx and production CJS).
 * Falls back to "(unknown)" when .git is absent (e.g. inside a stripped container).
 */
function resolveCommitSha(): string {
  try {
    return execSync("git rev-parse HEAD", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "(unknown)";
  }
}

export const commitSha: string = resolveCommitSha();
