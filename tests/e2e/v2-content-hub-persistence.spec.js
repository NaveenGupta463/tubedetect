import { expect, test } from '@playwright/test';

const API = process.env.E2E_API_URL || 'http://localhost:3002';

test('V2 Content Hub shows saved draft notes and preserves them after reload', async ({ page, request }) => {
  const clientId = `e2e-content-hub-${Date.now()}`;
  const topic = `E2E Content Hub Draft ${Date.now()}`;
  let draftId;

  const saveRes = await request.post(`${API}/api/drafts`, {
    data: {
      client_id: clientId,
      channel_id: 'e2e-channel',
      topic,
      thread_id: 'e2e-thread',
      draft_key: `${clientId}:e2e-channel:${topic.toLowerCase().replace(/\W+/g, '-')}:e2e-thread`,
      cards: [
        {
          type: 'note',
          data: {
            section: 'Episode Arc',
            content: 'Open with the audience tension, build through proof, and close with a practical next step.',
          },
        },
        {
          type: 'note',
          data: {
            section: 'Questions',
            content: 'What changed your mind, what do people misunderstand, and what should viewers do next?',
          },
        },
      ],
    },
  });
  expect(saveRes.ok()).toBeTruthy();
  draftId = (await saveRes.json()).id;

  await page.addInitScript((id) => {
    window.localStorage.setItem('ti_client_id', id);
  }, clientId);

  await page.goto('/index-v2.html');
  const firstDraftsLoad = page.waitForResponse(response =>
    response.url().includes('/api/drafts?') &&
    response.url().includes(encodeURIComponent(clientId))
  );
  await page.getByRole('button', { name: 'Content Hub' }).click();
  await firstDraftsLoad;
  await expect(page.getByText('Your saved scripts and outlines from Copilot')).toBeVisible();
  await expect(page.getByText(topic)).toBeVisible();

  await page.getByRole('button', { name: /Drafts/ }).click();
  await expect(page.getByText(topic)).toBeVisible();

  await page.getByRole('button', { name: 'View' }).first().click();
  await expect(page.getByText('Episode Arc')).toBeVisible();
  await expect(page.getByText('Questions')).toBeVisible();
  await expect(page.getByText('Open with the audience tension')).toBeVisible();

  await page.reload();
  const secondDraftsLoad = page.waitForResponse(response =>
    response.url().includes('/api/drafts?') &&
    response.url().includes(encodeURIComponent(clientId))
  );
  await page.getByRole('button', { name: 'Content Hub' }).click();
  await secondDraftsLoad;
  await expect(page.getByText(topic)).toBeVisible();
  await page.getByRole('button', { name: /Drafts/ }).click();
  await expect(page.getByText(topic)).toBeVisible();

  if (draftId) {
    await request.delete(`${API}/api/drafts/${draftId}?client_id=${encodeURIComponent(clientId)}`);
  }
});
