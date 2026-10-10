// Renders frontend/public/icons/favicon.svg into the PNG icons the PWA manifest needs.
// Usage: node scripts/make-icons.mjs   (set PW_CHROMIUM_PATH to reuse a local Chromium)
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconDir = path.join(root, 'frontend', 'public', 'icons');
const svg = await readFile(path.join(iconDir, 'favicon.svg'), 'utf8');

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
});
const page = await browser.newPage();

async function render(file, size, { maskable = false } = {}) {
  await page.setViewportSize({ width: size, height: size });
  // Maskable icons keep the logo inside the central 80% safe zone on a full-bleed background.
  const inner = maskable ? Math.round(size * 0.72) : size;
  const radius = maskable ? 0 : Math.round(size * 0.22);
  await page.setContent(
    `<html><body style="margin:0;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;background:${maskable ? '#1f6b3e' : 'transparent'}">
      <div style="width:${inner}px;height:${inner}px;border-radius:${radius}px;overflow:hidden">${svg.replace('<svg', `<svg width="${inner}" height="${inner}"`)}</div>
    </body></html>`,
  );
  await page.screenshot({ path: path.join(iconDir, file), omitBackground: !maskable });
  console.log('wrote', file);
}

await render('icon-192.png', 192);
await render('icon-512.png', 512);
await render('apple-touch-icon.png', 180, { maskable: true });
await render('maskable-512.png', 512, { maskable: true });
await browser.close();
