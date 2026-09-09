/**
 * Default fetch implementation that preserves the global receiver.
 *
 * Never store `globalThis.fetch` in a variable and call it detached:
 * inside MV3 service workers (`WorkerGlobalScope`) that throws
 * `TypeError: Failed to execute 'fetch' ...: Illegal invocation`.
 * Always use this helper (or `fetch.bind(globalThis)`) as the default
 * fetch implementation.
 */
export function defaultFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  return globalThis.fetch(input as any, init);
}
