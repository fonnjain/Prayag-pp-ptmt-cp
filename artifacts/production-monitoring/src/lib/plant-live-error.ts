/**
 * Error classification logic for the plant-live API error branch.
 *
 * Shared between the Velocity page UI (plumbing-velocity.tsx) and its
 * unit-test suite (plant-live-error.test.ts).  Both must use this module so
 * that a regression in heading/detail strings or classification priority is
 * caught by the tests.
 *
 * The API surfaces three distinct failure shapes via HTTP status codes:
 *   503  — PRAYAG_PLANT_API_KEY is absent (infrastructure config gap)
 *   504  — upstream prayag-plant.com timed out (slow / overloaded)
 *   502  — upstream returned a non-2xx error, sign-in redirect, or non-JSON body
 *
 * The custom react-query fetch wrapper attaches the parsed response body
 * to `error.data` so we can inspect structured fields.  As a fallback the
 * raw HTTP status appears in `error.message` (e.g. "HTTP 504").
 */

export interface PlantLiveErrorShape {
  message: string;
  data?: { code?: string; upstreamErrorType?: string };
}

export interface PlantLiveErrorCopy {
  heading: string;
  detail: string;
  hint: string;
}

/**
 * Classify a plant-live API error into user-facing copy.
 *
 * @param error  - the error object thrown by the react-query hook
 * @param month  - the period currently shown (used in diagnostic hints)
 */
export function classifyPlantLiveError(
  error: PlantLiveErrorShape,
  month: string,
): PlantLiveErrorCopy {
  const msg: string = error.message ?? String(error);
  const errorData = error.data;

  const is503 = msg.includes("503");
  const isTimeout =
    msg.includes("504") ||
    errorData?.code === "UPSTREAM_TIMEOUT" ||
    errorData?.upstreamErrorType === "timeout";
  const isAuthRedirect =
    errorData?.code === "UPSTREAM_AUTH_REDIRECT" ||
    errorData?.upstreamErrorType === "auth-redirect";
  const isBadJson = errorData?.upstreamErrorType === "bad-json";

  if (is503) {
    return {
      heading: "Plant live API not configured",
      detail:
        "The PRAYAG_PLANT_API_KEY secret is missing in the production environment. Deploy environments do not inherit dev secrets automatically — add it via the deployment secrets panel.",
      hint: `Diagnostic: GET /api/plant-live/periods lists valid period tokens. GET /api/plant-live/summary?period=${month}&plant=PIPE shows the raw status.`,
    };
  }

  if (isTimeout) {
    return {
      heading: "Plant live API timed out",
      detail:
        "The upstream prayag-plant.com service did not respond within 20 s. The service may be slow, overloaded, or temporarily unreachable. Check the server log for details or increase UPSTREAM_TIMEOUT_MS if the service consistently needs more time.",
      hint: `Diagnostic: GET /api/plant-live/summary?period=${month}&plant=PIPE — if it also times out, the upstream itself is the bottleneck.`,
    };
  }

  if (isAuthRedirect) {
    return {
      heading: "Live machine data needs attention",
      detail:
        "The upstream plant service redirected this API request to its sign-in page. Its service API authentication must be restored before live machine figures can be loaded.",
      hint: "The monthly and weekly monitoring data is still available. Refresh this card after the upstream service authentication is repaired.",
    };
  }

  if (isBadJson) {
    return {
      heading: "Live machine data returned an unexpected response",
      detail:
        "The upstream plant service returned a non-JSON page instead of live machine data. This is commonly caused by an upstream sign-in or error page.",
      hint: "The monthly and weekly monitoring data is still available. Refresh this card after the upstream response is restored.",
    };
  }

  return {
    heading: "Could not load plant live data",
    detail: `The upstream plant service returned an error (${msg}). Check that prayag-plant.com is reachable and the API key is valid.`,
    hint: `Diagnostic: GET /api/plant-live/periods lists valid period tokens. GET /api/plant-live/summary?period=${month}&plant=PIPE shows the raw status.`,
  };
}
