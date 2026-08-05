import { expect, type Page, type Response } from "@playwright/test";

/**
 * Triggers `action` (a click, typically) and waits for the matching non-GET API response, asserting
 * it succeeded. Every mutating page in this app is a client component that `fetch`es a JSON API
 * route rather than performing a full form POST, so waiting on Playwright's own navigation events
 * is not enough to know a save has actually landed — this is the one reliable signal.
 */
export async function submitAndWaitForApi(
  page: Page,
  urlIncludes: string,
  action: () => Promise<void>,
): Promise<Response> {
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.url().includes(urlIncludes) && candidate.request().method() !== "GET",
    ),
    action(),
  ]);
  expect(response.ok(), `${urlIncludes} responded with ${response.status()}`).toBeTruthy();
  return response;
}

/** Extracts the trailing UUID-shaped path segment from a URL, e.g. after a create-then-redirect. */
export function idFromUrl(url: string): string {
  const match = /([0-9a-f-]{36})(?:[/?#]|$)/i.exec(url);
  if (!match?.[1]) throw new Error(`Could not find a record id in URL: ${url}`);
  return match[1];
}
