import type { InputReadDiagnostics } from "./input-diagnostics";

/**
 * Raised when the live pending-order source cannot be read at all.
 *
 * A successful read with no recognized rows is intentionally not represented by
 * this error: that case remains a valid zero-pending result with diagnostics.
 */
export class LivePendingReadError extends Error {
  readonly code = "LIVE_PENDING_READ_FAILED";

  constructor(
    public readonly diagnostics: InputReadDiagnostics,
    public readonly causeMessage: string,
  ) {
    super(
      `Live pending source read failed for ${diagnostics.source}: ${causeMessage}. ` +
      "Corrective replan was not calculated; restore the source and retry.",
    );
    this.name = "LivePendingReadError";
  }
}