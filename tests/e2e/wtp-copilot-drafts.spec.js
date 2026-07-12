import { expect, test } from '@playwright/test';

const API = process.env.E2E_API_URL || 'http://localhost:3002';

test('WTP Act on this handoff creates saveable Copilot sections under one draft topic', async ({ page, request }) => {
  await page.goto('/index-v2.html');
  await page.getByRole('button', { name: 'What to Post' }).click();
  await expect(page.getByRole('heading', { name: 'What should you post next?' })).toBeVisible();
  await page.waitForTimeout(1000);

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('copilot:open', {
      detail: {
        podcastTheme: {
          title: 'Talk to a finance creator about why young Indians struggle to build wealth',
          evidence: 'money mindset',
          guest: 'personal finance creator or wealth coach',
          angle: 'Make the episode about behavior, status pressure, saving discipline, and the gap between earning more and actually becoming wealthy.',
          peer_count: 3,
          avg_views: 104000,
        },
      },
    }));
  });

  await expect(page.getByText('Good theme. I can help shape this into a watchable conversation')).toBeVisible();

  await page.getByRole('button', { name: 'Build episode arc' }).click();
  await expect(page.getByText('Episode arc for "Talk to a finance creator')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save to Draft' })).toBeVisible();

  await page.getByRole('button', { name: 'Save to Draft' }).last().click();
  await expect(page.getByText('Saved to Hub')).toBeVisible();

  await page.getByRole('button', { name: 'Draft questions' }).last().click();
  await expect(page.getByText('Questions for "Talk to a finance creator')).toBeVisible();
  await page.getByRole('button', { name: 'Save to Draft' }).last().click();

  await page.getByRole('button', { name: 'Find tension' }).last().click();
  await expect(page.getByText('Tension map for "Talk to a finance creator')).toBeVisible();

  await page.getByRole('button', { name: 'Plan clips' }).last().click();
  await expect(page.getByText('Shorts/Reels plan for "Talk to a finance creator')).toBeVisible();

  const clientId = await page.evaluate(() => localStorage.getItem('ti_client_id'));
  expect(clientId).toBeTruthy();

  const listRes = await request.get(`${API}/api/drafts?client_id=${encodeURIComponent(clientId)}`);
  expect(listRes.ok()).toBeTruthy();
  const drafts = await listRes.json();
  const draft = drafts.find(d => d.topic === 'Talk to a finance creator about why young Indians struggle to build wealth');
  expect(draft).toBeTruthy();
  expect(draft.cards.map(c => c.data?.section)).toEqual(expect.arrayContaining(['Episode Arc', 'Questions']));

  await request.delete(`${API}/api/drafts/${draft.id}?client_id=${encodeURIComponent(clientId)}`);
});
