import { expect, test } from '@playwright/test';

test('V2 command search still returns results after selecting a previous channel', async ({ page }) => {
  const searchResponses = [];
  page.on('response', async (response) => {
    if (!response.url().includes('/api/channel-cache/search?')) return;
    const data = await response.json().catch(() => null);
    searchResponses.push({
      url: response.url(),
      names: (data?.results || []).map(r => r.name).slice(0, 5),
    });
  });

  await page.goto('/index-v2.html');
  await expect(page.getByRole('button', { name: 'What to Post' })).toBeVisible();

  await page.getByRole('button', { name: /Search/ }).first().click();
  const searchInput = page.locator('input[placeholder*="Search channels"]').first();
  await expect(searchInput).toBeVisible();
  await searchInput.fill('raj shamani');

  const rajResult = page.getByText('Raj Shamani', { exact: true }).first();
  await expect(rajResult).toBeVisible();
  await rajResult.click();
  await expect(page.getByText('Raj Shamani', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: /Search/ }).first().click();
  const secondSearchInput = page.locator('input[placeholder*="Search channels"]').first();
  await expect(secondSearchInput).toBeVisible();
  const technicalResponse = page.waitForResponse(response =>
    response.url().includes('/api/channel-cache/search?') &&
    response.url().includes('technical%20guruji')
  );
  await secondSearchInput.fill('technical guruji');
  await technicalResponse;

  await expect(page.getByText('Technical Guruji', { exact: true }), JSON.stringify(searchResponses, null, 2)).toBeVisible();
  await expect(page.getByText(/No results for "technical guruji"/)).toHaveCount(0);
});

test('V2 command search falls back to live YouTube results for unseeded channels', async ({ page }) => {
  await page.goto('/index-v2.html');
  await expect(page.getByRole('button', { name: 'What to Post' })).toBeVisible();

  await page.getByRole('button', { name: /Search/ }).first().click();
  const searchInput = page.locator('input[placeholder*="Search channels"]').first();
  await expect(searchInput).toBeVisible();

  const liveResponse = page.waitForResponse(response =>
    response.url().includes('/api/channel-cache/search-youtube?') &&
    response.url().includes('%40veritasium')
  );
  await searchInput.fill('@veritasium');
  await liveResponse;

  await expect(page.getByText('Veritasium', { exact: true })).toBeVisible();
  await expect(page.getByText(/No results for "@veritasium"/)).toHaveCount(0);
});

test('V2 command search falls back to live YouTube results for unseeded name queries', async ({ page }) => {
  await page.goto('/index-v2.html');
  await expect(page.getByRole('button', { name: 'What to Post' })).toBeVisible();

  await page.getByRole('button', { name: /Search/ }).first().click();
  const searchInput = page.locator('input[placeholder*="Search channels"]').first();
  await expect(searchInput).toBeVisible();

  await searchInput.fill('rom rom ji');

  await expect(page.getByText('Rom Rom Ji', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/No results for "rom rom ji"/)).toHaveCount(0);
});
