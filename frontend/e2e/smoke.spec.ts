import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const png = readFileSync(path.join(here, '..', 'public', 'icons', 'icon-512.png'));
const shotsDir = process.env.SCREENSHOTS_DIR;

/** The mock AI reads the file name, so "banana.jpg" sorts as wet waste. */
const photo = (name: string) => ({ name, mimeType: 'image/png', buffer: png });

async function shot(page: Page, name: string) {
  if (!shotsDir) return;
  // Let map tiles and weather finish loading before capturing.
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
  await page.screenshot({ path: path.join(shotsDir, `${name}.png`), fullPage: false });
}

async function loginAs(page: Page, role: 'Resident' | 'Driver' | 'Officer' | 'Recycler') {
  await page.goto('/login');
  await page.getByRole('button', { name: new RegExp(`^${role}`) }).click();
}

test.describe.configure({ mode: 'serial' });

test('resident: home, sort, pickup, report, Hindi', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByText('Try the demo as')).toBeVisible();
  await shot(page, '01-login');
  await page.getByRole('button', { name: /^Resident/ }).click();

  await expect(page.getByRole('heading', { name: /Heer/ })).toBeVisible();
  await expect(page.getByText('Garbage truck').first()).toBeVisible();
  await expect(page.getByText('Pocket D, Lane 4').first()).toBeVisible();
  await shot(page, '02-resident-home');

  // Snap to Sort: a banana peel is wet waste.
  await page.getByRole('link', { name: 'Snap to Sort' }).click();
  await page
    .getByRole('button', { name: /Upload/ })
    .first()
    .click();
  await page.getByTestId('photo-input').setInputFiles(photo('banana.jpg'));
  await expect(page.getByRole('heading', { name: 'Banana peel' })).toBeVisible();
  await expect(page.getByText('Wet waste', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request pickup' })).toHaveCount(0);

  // A bottle is recyclable: request a pickup straight from the result.
  await page.getByRole('button', { name: 'Snap another' }).click();
  await page
    .getByRole('button', { name: /Upload/ })
    .first()
    .click();
  await page.getByTestId('photo-input').setInputFiles(photo('bottle.jpg'));
  await expect(page.getByRole('heading', { name: 'Plastic bottle' })).toBeVisible();
  await shot(page, '03-snap-result');
  await page.getByRole('button', { name: 'Request pickup' }).click();
  await expect(page.getByRole('button', { name: 'Plastic' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByLabel('Phone for the recycler to call').fill('+919800000001');
  await page.getByRole('button', { name: 'Find a recycler' }).click();
  await expect(page.getByText('Waiting for a recycler').first()).toBeVisible();

  // Unsure photo -> manual choice.
  await page.goto('/resident/snap');
  await page
    .getByRole('button', { name: /Upload/ })
    .first()
    .click();
  await page.getByTestId('photo-input').setInputFiles(photo('blurry.jpg'));
  await expect(page.getByText('Not sure about this one')).toBeVisible();
  await page.getByRole('button', { name: /^E-waste/ }).click();
  await expect(page.getByText('Your choice')).toBeVisible();

  // Report a dump with GPS: AI severity and the status tracker.
  await page.goto('/resident/report');
  await page
    .getByRole('button', { name: /Upload/ })
    .first()
    .click();
  await page.getByTestId('photo-input').setInputFiles(photo('dump-near-drain.jpg'));
  await expect(page.getByText('Using your location')).toBeVisible();
  await page.getByLabel('Add a note (optional)').fill('Next to the temple gate');
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByText('High severity')).toBeVisible();
  await expect(page.getByText('Report sent')).toBeVisible();
  await shot(page, '04-report');

  // Live truck map.
  await page.getByRole('link', { name: 'Track', exact: true }).click();
  await expect(page.getByText('Next stops')).toBeVisible();
  await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await shot(page, '05-track');

  // Hindi.
  await page.getByRole('button', { name: 'हिन्दी में देखें' }).click();
  await expect(page.getByText('गाड़ी रास्ते में')).toBeVisible();
  await page.getByRole('link', { name: 'होम', exact: true }).click();
  await expect(page.getByRole('link', { name: 'फ़ोटो से छाँटें' })).toBeVisible();
  await shot(page, '06-home-hindi');
  await page.getByRole('button', { name: 'View in English' }).click();
});

test('driver: done and skip update the route', async ({ page }) => {
  await loginAs(page, 'Driver');
  // The seeded driver prefers Hindi, so the app opens in Hindi.
  await expect(page.getByRole('heading', { name: 'आज का रूट' })).toBeVisible();
  await page.getByRole('button', { name: 'View in English' }).click();
  await expect(page.getByRole('heading', { name: "Today's route" })).toBeVisible();
  const progress = page.getByText(/\d+\/\d+ stops/);
  await expect(progress).toContainText('0/');
  await shot(page, '07-driver-route');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(progress).toContainText('1/');
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByRole('button', { name: 'Parked cars' }).click();
  await page.getByRole('button', { name: 'Skip stop' }).click();
  await expect(progress).toContainText('2/');
  await expect(page.getByText(/Skipped: Parked cars/)).toBeVisible();
  await page.getByRole('link', { name: 'Map', exact: true }).click();
  await expect(page.getByText('Next stop')).toBeVisible();
  await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await shot(page, '08-driver-map');
});

test('officer: inbox, resolve with after-photo, plan, risk', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAs(page, 'Officer');
  await expect(page.getByText('Open reports')).toBeVisible();
  await expect(page.getByText("Tomorrow's risk prediction")).toBeVisible();
  await expect(page.getByText('Savings vs fixed route').first()).toBeVisible();
  await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await shot(page, '09-officer-overview');

  await page.getByRole('button', { name: "Run tonight's plan now" }).click();
  await expect(page.getByText(/^Planned /)).toBeVisible();

  await page
    .locator('.sidebar')
    .getByRole('link', { name: /^Reports/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Reports inbox' })).toBeVisible();
  // The resident's high-severity report from the first test.
  await page
    .getByRole('row', { name: /Pocket D, Lane 4/ })
    .first()
    .click();
  await expect(page.getByText('Next to the temple gate')).toBeVisible();
  await shot(page, '10-officer-report');
  await page.getByRole('button', { name: 'Resolve with after-photo' }).click();
  await page
    .getByRole('button', { name: /Upload/ })
    .first()
    .click();
  await page.getByTestId('photo-input').setInputFiles(photo('clean.jpg'));
  await page.getByLabel('Note for the resident (optional)').fill('Cleared and bin replaced');
  await page.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(page.getByText('Marked resolved')).toBeVisible();

  await page.getByRole('link', { name: 'Risk prediction', exact: true }).first().click();
  await expect(page.getByText('How the score works')).toBeVisible();
  await shot(page, '11-officer-risk');
  await page.getByRole('link', { name: 'Routes', exact: true }).first().click();
  await expect(page.getByText('Old fixed route', { exact: true })).toBeVisible();
  await shot(page, '12-officer-routes');
});

test('resident sees the resolution and the lane alert', async ({ page }) => {
  await loginAs(page, 'Resident');
  await page.goto('/resident/reports');
  await expect(page.getByText('After cleaning')).toBeVisible();
  await expect(page.getByText('Cleared and bin replaced')).toBeVisible();
  await page.goto('/resident/alerts');
  await expect(page.getByText(/Collected|stops away|missed|collected/i).first()).toBeVisible();
});

test('recycler: accept and complete a pickup', async ({ page }) => {
  await loginAs(page, 'Recycler');
  await expect(page.getByRole('heading', { name: /नमस्ते, Sunil/ })).toBeVisible();
  await page.getByRole('button', { name: 'View in English' }).click();
  await expect(page.getByRole('heading', { name: /Welcome, Sunil/ })).toBeVisible();
  await expect(page.getByText('Matched to you').first()).toBeVisible();
  await shot(page, '13-recycler-requests');
  await page.getByRole('button', { name: 'Accept' }).first().click();
  await expect(page.getByText(/Accepted! Call the resident/)).toBeVisible();
  await page.getByRole('link', { name: 'My jobs', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mark done' }).first()).toBeVisible();
  await shot(page, '14-recycler-jobs');
  const before = await page.getByRole('button', { name: 'Mark done' }).count();
  await page.getByRole('button', { name: 'Mark done' }).first().click();
  await expect(page.getByRole('button', { name: 'Mark done' })).toHaveCount(before - 1);
});
