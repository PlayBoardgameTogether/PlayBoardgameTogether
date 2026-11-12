import { expect, type Locator } from '@playwright/test';

export async function reachable(control: Locator) {
  await control.scrollIntoViewIfNeeded();
  // Center after native validation; Chromium can leave a fractional pixel above the viewport.
  await control.evaluate((element) =>
    element.scrollIntoView({ block: 'center', behavior: 'instant' }),
  );
  await expect(control).toBeInViewport({ ratio: 1 });
  await expect
    .poll(() =>
      control.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return hit === element || element.contains(hit);
      }),
    )
    .toBe(true);
}
