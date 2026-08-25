/**
 * Error classification shared by the live regression runner's endpoint
 * fetchers. A 504 (or the API's explicit timeout code) means the check could
 * not evaluate the application; it is not evidence of a plan defect.
 */
export class UpstreamAvailabilityError extends Error {
  readonly kind = "upstream-availability" as const;
  readonly code = "UPSTREAM_TIMEOUT" as const;
  readonly retryable = true as const;

  constructor(
    public readonly url: string,
    public readonly status: number,
  ) {
    super(
      `UPSTREAM AVAILABILITY: ${url} returned HTTP ${status} (UPSTREAM_TIMEOUT); ` +
      "the upstream workbook service did not respond in time — retry the regression run",
    );
    this.name = "UpstreamAvailabilityError";
  }
}

function bodyHasTimeoutCode(body: string): boolean {
  return /"code"\s*:\s*"UPSTREAM_TIMEOUT"/i.test(body)
    || /"error"\s*:\s*"UPSTREAM_TIMEOUT"/i.test(body);
}

function errorLooksLikeTimeout(error: unknown): boolean {
  return error instanceof Error
    && (error.name === "TimeoutError"
      || error.name === "AbortError"
      || /\btimeout\b|\btimed out\b/i.test(error.message));
}

/**
 * Convert an unsuccessful endpoint response into a named availability error
 * when the API has identified an upstream timeout. Other responses retain the
 * response body so application failures remain actionable.
 */
export function classifyEndpointFailure(url: string, status: number, body: string): Error {
  if (status === 408 || status === 504 || bodyHasTimeoutCode(body)) {
    return new UpstreamAvailabilityError(url, status);
  }
  return new Error(`HTTP ${status} from ${url}: ${body}`);
}

/** Keep transport-level timeouts distinguishable from application failures. */
export function classifyTransportFailure(url: string, error: unknown): Error {
  if (errorLooksLikeTimeout(error)) {
    return new UpstreamAvailabilityError(url, 0);
  }
  return error instanceof Error ? error : new Error(String(error));
}