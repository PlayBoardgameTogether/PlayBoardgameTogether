import { expect, type Page } from '@playwright/test';

// Advancing a browser clock does not finish real network requests. Observe JSON
// consumption so completion-based polling tests advance only after each read.
export async function observePolls(page: Page, path: string) {
  await page.addInitScript((path) => {
    let completed = 0;
    const fetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await fetch(...args);
      const input = args[0];
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes(path)) {
        const json = response.json.bind(response);
        response.json = async () => {
          const body: unknown = await json();
          document.documentElement.dataset.completedPollReads = String(++completed);
          return body;
        };
      }
      return response;
    };
  }, path);
  const count = async () =>
    Number(await page.locator('html').getAttribute('data-completed-poll-reads'));
  return {
    count,
    async wait(expected: number) {
      await expect.poll(count).toBe(expected);
      await page.evaluate(() => Promise.resolve());
    },
  };
}
