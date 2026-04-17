import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = 'file://' + path.join(here, 'index.html');
const outDir = path.join(here, 'out');

const WIDTH = 1200;
const HEIGHT = 750;
const DURATION_MS = 40_000;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 2,
  recordVideo: { dir: outDir, size: { width: WIDTH, height: HEIGHT } },
});

const page = await context.newPage();
await page.goto(htmlPath);
await page.waitForTimeout(DURATION_MS);

await page.close();
await context.close();
await browser.close();

console.log('Recorded video written to:', outDir);
