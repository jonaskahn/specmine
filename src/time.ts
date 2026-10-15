/**
 * Current-date line stamped into every LLM system prompt so relative time
 * references in content ("new 2026 model", "released last year") resolve
 * against today. Date-only (UTC) keeps prompts stable within a day.
 */
export function currentDateLine(): string {
  return `Current date: ${new Date().toISOString().slice(0, 10)} (UTC).`;
}
