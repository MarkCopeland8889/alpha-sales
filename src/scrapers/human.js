// "Basic Playwright" controller helpers: wait for the element, pause a short random
// moment, then act, so actions look less mechanical. Stealth browsers (Camoufox,
// Invisible Playwright) additionally humanize the mouse path themselves.
import { randInt, sleep } from '../core/utils.js';

export const pause = (min = 350, max = 1100) => sleep(randInt(min, max));

export async function click(page, selector, { timeout = 30000, delay = [250, 900] } = {}) {
  await page.waitForSelector(selector, { state: 'visible', timeout });
  await pause(...delay);
  await page.click(selector, { timeout });
}

export async function type(page, selector, text, { timeout = 30000, perChar = [40, 140] } = {}) {
  await page.waitForSelector(selector, { state: 'visible', timeout });
  await pause(200, 600);
  await page.click(selector, { timeout });
  for (const ch of String(text)) {
    await page.keyboard.type(ch);
    await sleep(randInt(...perChar));
  }
}

export async function fill(page, selector, value, { timeout = 30000 } = {}) {
  await page.waitForSelector(selector, { state: 'visible', timeout });
  await pause(200, 600);
  await page.fill(selector, value, { timeout });
}

// Scrolls down in uneven steps. Returns true if the page height grew (more content loaded).
export async function scroll(page, { steps = 3, px = [400, 900], wait = [600, 1500] } = {}) {
  const before = await page.evaluate(() => document.body.scrollHeight).catch(() => 0);
  for (let i = 0; i < steps; i += 1) {
    await page.mouse.wheel(0, randInt(...px));
    await sleep(randInt(...wait));
  }
  const after = await page.evaluate(() => document.body.scrollHeight).catch(() => 0);
  return after > before;
}

// Scrolls until the page stops growing (or maxRounds is reached).
export async function scrollToEnd(page, { maxRounds = 30 } = {}) {
  let still = 0;
  for (let i = 0; i < maxRounds && still < 2; i += 1) {
    const grew = await scroll(page, { steps: 2 });
    still = grew ? 0 : still + 1;
  }
}

// Clicks a "Load more"/"Show more" style button repeatedly (LinkedIn activity, comments, ...).
export async function clickRepeatedly(page, selector, { times = 10, scrollBetween = true } = {}) {
  let clicked = 0;
  for (let i = 0; i < times; i += 1) {
    if (scrollBetween) await scroll(page, { steps: 2 });
    const visible = await page.isVisible(selector).catch(() => false);
    if (!visible) break;
    await click(page, selector, { timeout: 8000 });
    clicked += 1;
    await pause(900, 2000);
  }
  return clicked;
}
