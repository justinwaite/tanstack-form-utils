/**
 * Builds the `fieldErrors` of a `SubmissionResponse` for the Zod and Effect
 * entry points. Internal module.
 */

/**
 * Keeps the first message for each field path. A schema reports the checks of
 * a field in order, so a field that fails several checks shows its first
 * message, such as "Required" before "Enter a valid email". The client shows
 * the first message too. `fromEntries` defines own properties, so a
 * `__proto__` path can't hit the setter.
 */
export function firstMessagePerPath(
  entries: Iterable<readonly [path: string, message: string]>,
): Partial<Record<string, string>> {
  const messages = new Map<string, string>();
  for (const [path, message] of entries) {
    if (!messages.has(path)) messages.set(path, message);
  }
  return Object.fromEntries(messages);
}
