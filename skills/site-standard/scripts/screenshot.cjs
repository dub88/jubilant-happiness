#!/usr/bin/env node
// Screenshot a page at a phone width and a desktop width, full height.
//
//   screenshot.cjs <url> [output-directory]
//
// Writes phone.png (390 wide) and desktop.png (1280 wide). Needs Playwright;
// if it is not installed this exits with code 3 and says so, and the caller
// should carry on without screenshots.
const { createRequire } = require('node:module');
const path = require('node:path');

function loadPlaywright() {
  for (const load of [require, createRequire(path.join(process.cwd(), 'package.json'))]) {
    try {
      return load('playwright');
    } catch {
      // try the next place
    }
  }
  return undefined;
}

async function main() {
  const [url, outDir = '.'] = process.argv.slice(2);
  if (!url) {
    console.error('usage: screenshot.cjs <url> [output-directory]');
    return 2;
  }
  const playwright = loadPlaywright();
  if (!playwright) {
    console.error('Playwright is not installed, so no screenshots were taken. Review the page another way, or skip this step and say so.');
    return 3;
  }
  const browser = await playwright.chromium.launch();
  try {
    for (const [name, width, height] of [['phone', 390, 844], ['desktop', 1280, 900]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
      const file = path.join(outDir, `${name}.png`);
      await page.screenshot({ path: file, fullPage: true });
      await page.close();
      console.log(file);
    }
  } finally {
    await browser.close();
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`Could not take screenshots: ${error.message}`);
    process.exit(1);
  },
);
