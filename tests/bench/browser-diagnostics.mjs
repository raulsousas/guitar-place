import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

/** Servidor estático mínimo sobre dist/ (vite preview sai logo em segundo plano neste ambiente). */
const root = join(process.cwd(), 'dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  let p = join(root, decodeURIComponent((req.url ?? '/').split('?')[0]));
  try {
    if ((await stat(p)).isDirectory()) p = join(p, 'index.html');
  } catch {
    p = join(root, 'index.html');
  }
  try {
    res.setHeader('Content-Type', types[extname(p)] ?? 'application/octet-stream');
    res.end(await readFile(p));
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((r) => server.listen(4180, r));

const seconds = Number(process.argv[2] ?? 30);
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const ctx = await browser.newContext({ permissions: ['microphone'] });
const page = await ctx.newPage();
await page.goto('http://localhost:4180/');

const results = [];
for (const win of [2048, 4096, 8192]) {
  await page.getByTestId('start-btn').click();
  await page.getByTestId('capture-active').waitFor();
  await page.getByTestId('window-size').getByRole('button', { name: String(win) }).click();
  await page.waitForTimeout(seconds * 1000);
  const diag = await page.getByTestId('engine-diagnostics').innerText();
  const rate = await page.getByTestId('capture-info').innerText();
  const heap = await page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null));
  results.push({ win, diag: diag.replace(/\s+/g, ' '), rate: rate.split('\n')[0], heapMB: heap });
  await page.getByTestId('stop-btn').click();
  await page.getByTestId('start-btn').waitFor();
}
console.log(JSON.stringify(results, null, 2));
await browser.close();
server.close();
