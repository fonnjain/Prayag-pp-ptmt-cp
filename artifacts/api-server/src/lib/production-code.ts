/**
 * Shared production-to-plan code normalisation.
 *
 * Production sheets may omit punctuation that is present in planning/master
 * data, for example A465 versus A-465. This is only for matching production
 * actuals to plan/reference rows; plan-to-plan identities must retain their
 * raw spelling.
 */
export function normalizeProductionCode(code: unknown): string {
  return String(code ?? "").trim().toUpperCase().replace(/[-\s.]/g, "");
}