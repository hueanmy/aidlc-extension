import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = 'file://' + path.join(here, 'agents.html');
const outDir = path.join(here, 'out-agents');

const WIDTH = 1080;
const HEIGHT = 1920;
const DURATION_MS = 48_000;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 1,
  recordVideo: { dir: outDir, size: { width: WIDTH, height: HEIGHT } },
});

const page = await context.newPage();
await page.goto(htmlPath);
await page.waitForTimeout(DURATION_MS);

await page.close();
await context.close();
await browser.close();

console.log('Recorded vertical video written to:', outDir);
