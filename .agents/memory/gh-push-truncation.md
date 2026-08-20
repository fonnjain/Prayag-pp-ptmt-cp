---
name: GitHub push via Contents API truncation
description: Pushing large files via GitHub Contents API silently truncates; use Git Trees API with utf-8 blobs instead.
---

# GitHub push via Contents API truncation

**Rule:** Never push source files to GitHub using `PUT /repos/.../contents/{path}` when the file exceeds ~61 KB. Use the Git Trees API with `encoding: "utf-8"` blobs instead.

**Why:** The Contents API requires base64-encoded content in the request body. When reading file content via `shellExec` (base64 -w0) or `readFile` in CodeExecution, the output silently caps at ~61 KB decoded regardless of the `maxOutputBytes` setting — the truncated base64 is accepted by GitHub without error, resulting in a shortened file on the remote with a misleading success (HTTP 200).

The truncation manifests as:
- GitHub file size ~61 KB regardless of actual file size
- File starts mid-statement (first N KB of content missing)
- Zero imports (import block is in the missing head)
- `truncated: false` reported by shellExec (the JS-level truncation is not detected)

**Correct approach — Git Trees API with UTF-8 blobs:**
1. `readFile({ path, maxBytes: 1048576 })` — MUST use camelCase `maxBytes` (underscore `max_bytes` is silently ignored, falling back to the 65 KB default which causes the same truncation)
2. Pass content directly (as a string, no base64) to `POST /repos/.../git/blobs` with `{ content: <string>, encoding: "utf-8" }`
3. Assemble a tree with `base_tree` pointing to the current HEAD tree, listing only the changed files
4. Create a commit and update the ref

**Post-push verification (mandatory):**
After every push, fetch each file's metadata via `GET /repos/.../contents/{path}?ref={commitSha}` and assert `data.size === localBytes` (from `wc -c` or `readFile.bytes`). A size mismatch means the push was truncated. Also run `tsc --noEmit` locally — since the local files are identical to the pushed content (confirmed by size match), a clean local tsc is equivalent to a clean pushed tsc.

**How to apply:**
- Any CodeExecution that pushes a file to GitHub must use the Git Trees API path above
- Add size verification as the final step before reporting success
- If `readFile` fails with "exceeds maxBytes", the parameter name is wrong (camelCase `maxBytes` required)

**Workspace fallback:** If the checkout's HTTPS Git credential is rejected, use the installed GitHub connector's authenticated proxy to create blobs, a tree, a commit, and a non-force ref update; verify the ref and file sizes afterward.
