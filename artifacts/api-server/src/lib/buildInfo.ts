import { execSync } from "child_process";

/**
 * SHA of the git commit that produced this running process.
 * Production builds inject GIT_COMMIT because stripped deployment artefacts do
 * not contain .git. The git fallback keeps local tsx development convenient.
 */
function resolveCommitSha(): string {
  const injected = process.env.GIT_COMMIT?.trim();
  if (injected) return injected;

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
