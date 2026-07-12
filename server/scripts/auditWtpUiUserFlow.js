'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('../../node_modules/playwright');
const BetterSqlite3 = require('../node_modules/better-sqlite3');

const ROOT = path.resolve(__dirname, '../..');
const DB_PATH = path.resolve(__dirname, '../data/scoring.db');
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5174';
const LIMIT = Math.max(1, Math.min(parseInt(process.argv[2] || '300', 10), 500));
const DEEP_LIMIT = Math.max(0, Math.min(parseInt(process.argv[3] || '18', 10), LIMIT));
const SELECT_MODE = process.env.WTP_UI_SELECT_MODE || 'direct'; // direct | search
const WTP_RESPONSE_TIMEOUT_MS = parseInt(process.env.WTP_UI_RESPONSE_TIMEOUT_MS || '22000', 10);
const WTP_DOM_TIMEOUT_MS = parseInt(process.env.WTP_UI_DOM_TIMEOUT_MS || '9000', 10);
const SAMPLE_MODE = process.env.WTP_UI_SAMPLE_MODE || 'random'; // random | edge
const SKIP_SUPPORT = process.env.WTP_UI_SKIP_SUPPORT === '1';
const READY_ONLY = process.env.WTP_UI_READY_ONLY === '1';
const SCREENSHOTS = process.env.WTP_UI_SCREENSHOTS !== '0';
const SUPPORT_WAIT_MS = Math.max(0, parseInt(process.env.WTP_UI_SUPPORT_WAIT_MS || '0', 10));
const EXPLICIT_CHANNEL_IDS = (process.env.WTP_UI_CHANNEL_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const OUT_DIR = path.join(ROOT, 'tmp');
const RUN_ID = `wtp-ui-audit-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const OUT_FILE = path.join(OUT_DIR, `${RUN_ID}.json`);
const SCREENSHOT_DIR = path.join(OUT_DIR, RUN_ID);
const AEVY_CHANNEL_ID = 'UCA295QVkf9O1RQ8_-s3FVXg';

function openDb() {
  const db = new BetterSqlite3(DB_PATH, { readonly: true, fileMustExist: true, timeout: 60000 });
  db.pragma('query_only = ON');
  db.pragma('busy_timeout = 60000');
  return db;
}

function sampleChannels(limit) {
  const db = openDb();
  try {
    if (EXPLICIT_CHANNEL_IDS.length) {
      const ids = EXPLICIT_CHANNEL_IDS.slice(0, limit);
      const placeholders = ids.map(() => '?').join(',');
      const orderCase = ids.map((_, i) => `WHEN ? THEN ${i}`).join(' ');
      return db.prepare(`
        SELECT ic.channel_id, ic.channel_name, COALESCE(ic.primary_niche, ic.niche) AS niche,
               ic.channel_subscribers, ccsp.primary_csp, cid.confidence AS dna_confidence,
               cid.sample_count, cid.drift_status
          FROM ingested_channels ic
          LEFT JOIN channel_content_strategy_profiles ccsp ON ccsp.channel_id = ic.channel_id
          LEFT JOIN creator_idea_dna cid ON cid.channel_id = ic.channel_id
         WHERE ic.channel_id IN (${placeholders})
         ORDER BY CASE ic.channel_id ${orderCase} ELSE ${ids.length} END
      `).all(...ids, ...ids);
    }

    if (SAMPLE_MODE === 'edge') {
      const channels = [];
      const seen = new Set();
      const add = (row) => {
        if (!row || seen.has(row.channel_id)) return;
        seen.add(row.channel_id);
        channels.push(row);
      };

      const baseSelect = `
        SELECT ic.channel_id, ic.channel_name, COALESCE(ic.primary_niche, ic.niche) AS niche,
               ic.channel_subscribers, ccsp.primary_csp, cid.confidence AS dna_confidence,
               cid.sample_count, cid.drift_status
          FROM ingested_channels ic
          JOIN channel_search_index csi ON csi.channel_id = ic.channel_id
          LEFT JOIN channel_content_strategy_profiles ccsp ON ccsp.channel_id = ic.channel_id
          LEFT JOIN creator_idea_dna cid ON cid.channel_id = ic.channel_id
         WHERE ingest_enabled = 1
           AND ic.channel_id IS NOT NULL
           AND ic.channel_name IS NOT NULL
           AND COALESCE(ic.primary_niche, ic.niche) IS NOT NULL
           AND ic.channel_subscribers BETWEEN 1000 AND 20000000
           AND EXISTS (
             SELECT 1 FROM ingested_videos iv
              WHERE iv.channel_id = ic.channel_id
                AND iv.published_at > datetime('now', '-180 days')
              LIMIT 1
           )
           ${READY_ONLY ? "AND cid.confidence IN ('medium','high') AND cid.confidence_score >= 0.48 AND cid.sample_count >= 20" : ''}
      `;

      add(db.prepare(`${baseSelect} AND ic.channel_id = ? LIMIT 1`).get(AEVY_CHANNEL_ID));

      const families = [
        'unclassified_low_signal',
        'news_event_bulletin',
        'gaming_entertainment',
        'comedy_sketch',
        'travel_lifestyle_vlog',
        'cooking_food_recipe',
        'yoga_fitness_practice',
        'wellness_transformation_teaching',
        'tech_review_gadget',
        'exam_demand_teaching',
        'general_education',
        'finance_investment_education',
        'personal_finance_teaching',
        'business_case_study',
        'curiosity_explainer',
        'indian_business_selfimprovement_podcast',
        'founder_economy_conversation',
        'personal_finance_guest_show',
        'spiritual_teaching_solo',
        'spiritual_geopolitics_guest_show',
      ];

      const perFamily = Math.max(1, Math.ceil(limit / families.length));
      const byFamilyStmt = db.prepare(`
        ${baseSelect}
           AND ccsp.primary_csp = ?
         ORDER BY
           CASE WHEN cid.confidence = 'low' THEN 0 ELSE 1 END,
           ABS(COALESCE(cid.sample_count, 0) - 20) ASC,
           random()
         LIMIT ?
      `);
      for (const family of families) {
        for (const row of byFamilyStmt.all(family, perFamily)) {
          add(row);
          if (channels.length >= limit) return channels;
        }
      }

      const fillStmt = db.prepare(`${baseSelect} ORDER BY random() LIMIT ?`);
      for (const row of fillStmt.all(limit * 2)) {
        add(row);
        if (channels.length >= limit) break;
      }
      return channels;
    }

    return db.prepare(`
      SELECT ic.channel_id, ic.channel_name, COALESCE(ic.primary_niche, ic.niche) AS niche,
             ic.channel_subscribers, ccsp.primary_csp, cid.confidence AS dna_confidence,
             cid.sample_count, cid.drift_status
      FROM ingested_channels ic
      JOIN channel_search_index csi ON csi.channel_id = ic.channel_id
      LEFT JOIN channel_content_strategy_profiles ccsp ON ccsp.channel_id = ic.channel_id
      LEFT JOIN creator_idea_dna cid ON cid.channel_id = ic.channel_id
      WHERE ingest_enabled = 1
        AND ic.channel_id IS NOT NULL
        AND ic.channel_name IS NOT NULL
        AND COALESCE(ic.primary_niche, ic.niche) IS NOT NULL
        AND ic.channel_subscribers BETWEEN 1000 AND 20000000
        AND EXISTS (
          SELECT 1 FROM ingested_videos iv
          WHERE iv.channel_id = ic.channel_id
            AND iv.published_at > datetime('now', '-180 days')
          LIMIT 1
        )
      ORDER BY random()
      LIMIT ?
    `).all(limit);
  } finally {
    db.close();
  }
}

function compactText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function inc(obj, key, by = 1) {
  obj[key] = (obj[key] || 0) + by;
}

async function clickIfVisible(locator, timeout = 1200) {
  try {
    await locator.first().waitFor({ state: 'visible', timeout });
    await locator.first().click();
    return true;
  } catch (_) {
    return false;
  }
}

async function searchAndSelect(page, channel) {
  await page.keyboard.press('Control+K');
  try {
    await page.locator('input[placeholder*="Search channels"]').first().waitFor({ state: 'visible', timeout: 2500 });
  } catch (_) {
    await page.getByRole('button', { name: /Search/ }).last().click({ timeout: 10000 });
  }
  const input = page.locator('input[placeholder*="Search channels"]').first();
  await input.waitFor({ state: 'visible', timeout: 10000 });
  await input.click();
  await input.fill('');
  await input.fill(channel.channel_name);

  const exact = page.getByText(channel.channel_name, { exact: true }).first();
  const resultRows = page.locator('div').filter({ hasText: /subscribers/ });
  try {
    await exact.waitFor({ state: 'visible', timeout: 12000 });
    await exact.click();
    return { selected: true, selection: 'exact' };
  } catch (_) {
    try {
      await resultRows.first().waitFor({ state: 'visible', timeout: 8000 });
      const row = resultRows.first();
      const text = compactText(await row.innerText().catch(() => ''));
      await row.click();
      return { selected: true, selection: 'first_result', result_text: text.slice(0, 180) };
    } catch (e) {
      const body = compactText(await page.locator('body').innerText().catch(() => ''));
      return { selected: false, error: 'search_no_result', body_excerpt: body.slice(0, 240) };
    }
  }
}

function beginWtpCapture(page) {
  const responseInfo = { wtp_status: null, wtp_ok: null };
  const promise = page.waitForResponse(r => r.url().includes('/api/intel/what-to-post?'), { timeout: WTP_RESPONSE_TIMEOUT_MS })
    .then(async r => {
      responseInfo.wtp_status = r.status();
      const data = await r.json().catch(() => null);
      responseInfo.wtp_ok = !!data?.ok;
      responseInfo.api_ideas = Array.isArray(data?.ideas) ? data.ideas.length : null;
      responseInfo.api_original_status = data?.original_bets?.status || null;
      responseInfo.api_original_ideas = Array.isArray(data?.original_bets?.ideas) ? data.original_bets.ideas.length : null;
      responseInfo.api_category = data?.niche_category || null;
      responseInfo.api_channel_count = data?.channel_count ?? null;
      responseInfo.api_video_count = data?.video_count ?? null;
      responseInfo.api_guest_intel_active = !!data?.guest_intel_active;
      responseInfo.api_podcast_intel = !!data?.podcast_intel;
      responseInfo.api_fallback = Array.isArray(data?.ideas)
        ? data.ideas.filter(i => i.source === 'fallback_evergreen').length
        : null;
    })
    .catch(e => {
      responseInfo.wtp_error = e.message;
    });
  return { responseInfo, promise };
}

async function readWtp(page, capture = null) {
  const activeCapture = capture || beginWtpCapture(page);
  if (!capture) {
    await page.getByRole('button', { name: 'What to Post' }).first().click({ timeout: 10000 }).catch(() => {});
  }
  await page.waitForTimeout(WTP_DOM_TIMEOUT_MS);
  await activeCapture.promise.catch(() => {});
  await page.waitForTimeout(650);
  await page.waitForFunction(({ expectOriginal }) => {
    const text = (document.body.innerText || '').replace(/\s+/g, ' ');
    if (/Could not reach server|Failed to load ideas|No community data yet|No active opportunities detected/i.test(text)) return true;
    if (expectOriginal && /Original Bets/i.test(text)) return true;
    if (/Save idea|Save topic|Save prompt|Act on this|\b\d{1,3}\s+SCORE\b/i.test(text)) return true;
    return false;
  }, { expectOriginal: (activeCapture.responseInfo.api_original_ideas || 0) > 0 }, { timeout: 7000 }).catch(() => {});
  if (!SKIP_SUPPORT && SUPPORT_WAIT_MS > 0) {
    await page.waitForTimeout(SUPPORT_WAIT_MS);
  }

  const body = compactText(await page.locator('body').innerText().catch(() => ''));
  const visibleError = /Could not reach server|Failed to load ideas|No community data yet|No active opportunities detected/i.exec(body)?.[0] || null;
  const actButtons = await page.getByRole('button', { name: /Act on this/i }).count().catch(() => 0);
  const saveButtons = await page.getByRole('button', { name: /Save idea|Save topic|Save prompt/i }).count().catch(() => 0);
  const validateButtons = await page.getByRole('button', { name: /Validate|Pre-Publish/i }).count().catch(() => 0);
  const originalHeaderVisible = /Original Bets/i.test(body);
  const moreSourcesVisible = /MORE SOURCES/i.test(body);
  const communityHotVisible = /Hot in Your Community/i.test(body);
  const moreSourceContentVisible = /Hot in Your Community|Adjacent Audiences|Global Gap|Search Trends|Rising Google|Trending in US\/UK|Topics your peers are getting views/i.test(body);
  const blankMoreSources = moreSourcesVisible && !moreSourceContentVisible;
  const mainIdeaVisible = actButtons > 0 || saveButtons > 0
    || /\b\d{1,3}\s+SCORE\b|Save idea|Save topic|Save prompt|Act on this|Long-Form|Your angle/i.test(body);
  const filterLabels = [];
  for (const name of ['All ideas', 'Act Now', 'Live Events', 'Seasonal', 'Rising', 'Evergreen', 'Unexplored', 'Saturated']) {
    if (await page.getByRole('button', { name: new RegExp(name, 'i') }).count().catch(() => 0)) filterLabels.push(name);
  }

  const visibleTitles = [];
  const candidates = await page.locator('div').evaluateAll(nodes => nodes
    .map(n => (n.innerText || '').replace(/\s+/g, ' ').trim())
    .filter(t => t && t.length >= 20 && t.length <= 220)
    .filter(t => /views|peers|channels|avg|score|evidence|guest|ACT NOW|Long-Form|Shorts|Rising|Evergreen/i.test(t))
    .slice(0, 12)
  ).catch(() => []);
  for (const t of candidates) if (!visibleTitles.includes(t)) visibleTitles.push(t);

  return {
    ...activeCapture.responseInfo,
    visible_error: visibleError,
    act_buttons: actButtons,
    save_buttons: saveButtons,
    validate_buttons: validateButtons,
    original_header_visible: originalHeaderVisible,
    original_hidden_bug: (activeCapture.responseInfo.api_original_ideas || 0) > 0 && !originalHeaderVisible,
    more_sources_visible: moreSourcesVisible,
    community_hot_visible: communityHotVisible,
    blank_more_sources: blankMoreSources,
    main_ideas_visible: mainIdeaVisible,
    hidden_ideas_bug: ((activeCapture.responseInfo.api_ideas || 0) > 0 || (activeCapture.responseInfo.api_original_ideas || 0) > 0)
      && !mainIdeaVisible
      && !activeCapture.responseInfo.api_podcast_intel,
    filters_visible: filterLabels,
    body_excerpt: body.slice(0, 700),
    visible_samples: visibleTitles.slice(0, 8),
  };
}

async function clickFilters(page) {
  const results = [];
  for (const name of ['All ideas', 'Rising', 'Evergreen', 'Unexplored', 'Saturated']) {
    const btn = page.getByRole('button', { name: new RegExp(name, 'i') }).first();
    if (!await clickIfVisible(btn, 800)) continue;
    await page.waitForTimeout(180);
    const body = compactText(await page.locator('body').innerText().catch(() => ''));
    results.push({
      filter: name,
      empty: /No ideas match this filter/i.test(body),
      error: /Could not reach server|Something went wrong|Failed to load/i.test(body),
    });
  }
  return results;
}

async function clickCopilotFlow(page) {
  const result = { opened: false, option_clicks: [], save_visible: false, errors: [] };
  const clicked = await clickIfVisible(page.getByRole('button', { name: /Act on this/i }).first(), 1200);
  if (!clicked) return result;
  result.opened = true;
  await page.waitForTimeout(600);
  const bodyAfterOpen = compactText(await page.locator('body').innerText().catch(() => ''));
  if (/Something went wrong|request times out|Could not reach server/i.test(bodyAfterOpen)) {
    result.errors.push('copilot_open_error');
  }

  for (const name of ['Build episode arc', 'Draft questions', 'Find tension', 'Plan clips']) {
    if (!await clickIfVisible(page.getByRole('button', { name }).last(), 700)) continue;
    await page.waitForTimeout(900);
    const body = compactText(await page.locator('body').innerText().catch(() => ''));
    result.option_clicks.push({
      option: name,
      save_visible: await page.getByRole('button', { name: /Save to Draft/i }).count().catch(() => 0) > 0,
      error: /Something went wrong|request times out|Could not reach server/i.test(body),
      excerpt: body.slice(-500),
    });
  }
  result.save_visible = await page.getByRole('button', { name: /Save to Draft/i }).count().catch(() => 0) > 0;
  return result;
}

function safeName(value) {
  return String(value || 'channel')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'channel';
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (SCREENSHOTS) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const channels = sampleChannels(LIMIT);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });

  const consoleErrors = [];
  const createPage = async () => {
    const p = await context.newPage();
    p.on('console', msg => {
      if (['error', 'warning'].includes(msg.type())) consoleErrors.push({ type: msg.type(), text: msg.text().slice(0, 240) });
    });
    p.on('pageerror', err => consoleErrors.push({ type: 'pageerror', text: err.message.slice(0, 240) }));
    return p;
  };

  const results = [];
  const deepEvery = DEEP_LIMIT > 0 ? Math.max(1, Math.floor(LIMIT / DEEP_LIMIT)) : Infinity;

  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    const started = Date.now();
    const row = {
      index: i + 1,
      channel_id: ch.channel_id,
      channel_name: ch.channel_name,
      niche: ch.niche,
      csp: ch.primary_csp || null,
      dna: {
        confidence: ch.dna_confidence || null,
        sample_count: ch.sample_count || null,
        drift_status: ch.drift_status || null,
      },
      ok: false,
      ms: null,
      search: null,
      wtp: null,
      filters: [],
      copilot: null,
      screenshot: null,
      error: null,
    };

    let page = null;
    try {
      page = await createPage();
      let wtpCapture = null;
      if (SELECT_MODE === 'search') {
        await page.goto(`${BASE_URL}/index-v2.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.getByRole('button', { name: 'What to Post' }).waitFor({ state: 'visible', timeout: 15000 });
        row.search = await searchAndSelect(page, ch);
        if (!row.search.selected) throw new Error(row.search.error || 'search_failed');
      } else {
        wtpCapture = beginWtpCapture(page);
        const params = new URLSearchParams({
          e2e: '1',
          e2e_skip_support: '1',
          nav: 'post',
          channel_id: ch.channel_id,
          name: ch.channel_name,
          niche: ch.niche || 'other',
          subs: String(ch.channel_subscribers || 0),
        });
        if (SKIP_SUPPORT) params.set('e2e_skip_support', '1');
        await page.goto(`${BASE_URL}/index-v2.html?${params.toString()}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        row.search = { selected: true, selection: 'e2e_direct_url' };
      }
      row.wtp = await readWtp(page, wtpCapture);
      const deepCheck = i % deepEvery === 0 && results.filter(r => r.copilot).length < DEEP_LIMIT;
      if (deepCheck) {
        row.filters = await clickFilters(page);
        row.copilot = await clickCopilotFlow(page);
      }
      const apiSucceeded = row.wtp.wtp_status === 200 && row.wtp.api_ideas !== 0;
      const uiSucceeded = row.wtp.main_ideas_visible && !row.wtp.visible_error;
      row.ok = (apiSucceeded || uiSucceeded)
        && !row.wtp.hidden_ideas_bug
        && !row.wtp.original_hidden_bug
        && !row.wtp.blank_more_sources;
      if (SCREENSHOTS && (deepCheck || !row.ok)) {
        const shot = path.join(SCREENSHOT_DIR, `${String(i + 1).padStart(3, '0')}-${safeName(ch.channel_name)}.png`);
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
        row.screenshot = path.relative(ROOT, shot);
      }
    } catch (e) {
      row.error = e.message;
    } finally {
      if (page && !page.isClosed()) await page.close().catch(() => {});
      row.ms = Date.now() - started;
      results.push(row);
      fs.writeFileSync(OUT_FILE, JSON.stringify({
        partial: true,
        requested: LIMIT,
        completed_so_far: results.length,
        results,
      }, null, 2));
      const status = row.ok ? 'ok' : 'fail';
      const ideaCount = row.wtp?.api_ideas ?? 'na';
      const err = row.error || row.wtp?.wtp_error || row.wtp?.visible_error || '';
      console.error(`[ui-audit] ${i + 1}/${channels.length} ${status} ${row.ms}ms ideas=${ideaCount} ${row.channel_name}${err ? ` — ${err.slice(0, 90)}` : ''}`);
    }
  }

  await browser.close();

  const summary = {
    sample_mode: SAMPLE_MODE,
    explicit_channels: EXPLICIT_CHANNEL_IDS.length,
    ready_only: READY_ONLY,
    skip_support_panels: SKIP_SUPPORT,
    screenshots_dir: SCREENSHOTS ? SCREENSHOT_DIR : null,
    requested: LIMIT,
    sampled: channels.length,
    completed: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    search_failures: results.filter(r => r.search && !r.search.selected).length,
    api_errors: results.filter(r => r.wtp && r.wtp.wtp_status && r.wtp.wtp_status !== 200).length,
    ui_errors: results.filter(r => r.wtp?.visible_error).length,
    zero_ideas: results.filter(r => r.wtp?.api_ideas === 0).length,
    hidden_ideas_bug: results.filter(r => r.wtp?.hidden_ideas_bug).length,
    original_hidden_bug: results.filter(r => r.wtp?.original_hidden_bug).length,
    blank_more_sources: results.filter(r => r.wtp?.blank_more_sources).length,
    original_visible_channels: results.filter(r => r.wtp?.original_header_visible).length,
    community_hot_visible_channels: results.filter(r => r.wtp?.community_hot_visible).length,
    more_sources_visible_channels: results.filter(r => r.wtp?.more_sources_visible).length,
    fallback_channels: results.filter(r => (r.wtp?.api_fallback || 0) > 0).length,
    avg_api_ideas: +(results.reduce((s, r) => s + (r.wtp?.api_ideas || 0), 0) / Math.max(1, results.filter(r => r.wtp).length)).toFixed(2),
    avg_original_ideas: +(results.reduce((s, r) => s + (r.wtp?.api_original_ideas || 0), 0) / Math.max(1, results.filter(r => r.wtp).length)).toFixed(2),
    by_niche: {},
    by_csp: {},
    console_errors: consoleErrors.slice(0, 50),
  };

  for (const r of results) {
    if (!summary.by_niche[r.niche]) summary.by_niche[r.niche] = { channels: 0, failed: 0, fallback: 0, zero: 0 };
    summary.by_niche[r.niche].channels++;
    if (!r.ok) summary.by_niche[r.niche].failed++;
    if ((r.wtp?.api_fallback || 0) > 0) summary.by_niche[r.niche].fallback++;
    if (r.wtp?.api_ideas === 0) summary.by_niche[r.niche].zero++;

    const csp = r.csp || 'unknown';
    if (!summary.by_csp[csp]) summary.by_csp[csp] = { channels: 0, failed: 0, original_visible: 0, community_hot: 0, blank_more_sources: 0 };
    summary.by_csp[csp].channels++;
    if (!r.ok) summary.by_csp[csp].failed++;
    if (r.wtp?.original_header_visible) summary.by_csp[csp].original_visible++;
    if (r.wtp?.community_hot_visible) summary.by_csp[csp].community_hot++;
    if (r.wtp?.blank_more_sources) summary.by_csp[csp].blank_more_sources++;
  }

  const report = { summary, results };
  fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    ...summary,
    report_file: OUT_FILE,
    sample_failures: results.filter(r => !r.ok).slice(0, 8).map(r => ({
      channel: r.channel_name,
      niche: r.niche,
      csp: r.csp,
      error: r.error,
      screenshot: r.screenshot,
      search: r.search,
      wtp: r.wtp && {
        status: r.wtp.wtp_status,
        error: r.wtp.visible_error || r.wtp.wtp_error,
        ideas: r.wtp.api_ideas,
        original_ideas: r.wtp.api_original_ideas,
        original_hidden_bug: r.wtp.original_hidden_bug,
        blank_more_sources: r.wtp.blank_more_sources,
      },
    })),
    deep_clicks: results.filter(r => r.copilot).map(r => ({
      channel: r.channel_name,
      niche: r.niche,
      filters: r.filters,
      copilot: r.copilot,
    })).slice(0, 10),
  }, null, 2));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
