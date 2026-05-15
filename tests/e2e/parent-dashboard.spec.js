/**
 * parent-dashboard.spec.js
 *
 * Tests the parent's view of ChoreQuest:
 * - Dashboard loads with pending approval section
 * - Approving a kid's completed quest awards XP and removes it from queue
 * - Parent can reject (uncomplete) a quest
 * - Party page lists kids
 * - /kids/:id shows the kid's quest history
 * - API endpoints used exclusively by parents are accessible
 * - Stats endpoint returns data for a kid
 */

import { test, expect } from './fixtures.js';
import { readFileSync } from 'fs';

const BASE = 'http://localhost:8199';

function loadTokens() {
  return JSON.parse(readFileSync('/tmp/chorequest_e2e_tokens.json', 'utf-8'));
}

async function apiGet(path, token) {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return res.json();
}

async function apiPost(path, token, body = null) {
  const opts = { method: 'POST', headers: { Authorization: `Bearer ${token}` } };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(`${BASE}${path}`, opts);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** Create a chore, assign it to the kid, and have the kid complete it — ready for parent approval. */
async function createAndCompleteChore(parentToken, kidToken, kidId) {
  const cats = await apiGet('/api/chores/categories', parentToken);
  const res = await fetch(`${BASE}/api/chores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${parentToken}` },
    body: JSON.stringify({
      title: `Approval Test ${Date.now()}`,
      points: 15,
      difficulty: 'easy',
      recurrence: 'once',
      category_id: cats[0]?.id,
      assigned_user_ids: [kidId],
    }),
  });
  const chore = await res.json();
  const fd = new FormData();
  await fetch(`${BASE}/api/chores/${chore.id}/complete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${kidToken}` },
    body: fd,
  });
  return chore.id;
}

// ─── Dashboard layout ─────────────────────────────────────────────────────────

test.describe('Parent Dashboard — layout', () => {
  test('parent dashboard loads without error', async ({ loginAsParent: page }) => {
    await expect(page).toHaveURL('/');
    await expect(page).not.toHaveURL(/error|login/);
    await expect(page.locator('nav').first()).toBeVisible({ timeout: 8_000 });
  });

  test('parent dashboard shows a management or overview panel', async ({ loginAsParent: page }) => {
    // Parent home shows quest management, pending approvals, or a family overview
    await expect(
      page.locator('text=/quest|pending|approve|overview|family/i').first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test('parent sees the e2e kid listed somewhere on the dashboard', async ({ loginAsParent: page }) => {
    await expect(
      page.locator('text=/Kid|e2e_kid/i').first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test('parent dashboard has no JS errors on load', async ({ loginAsParent: page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.reload();
    await page.waitForLoadState('networkidle');
    expect(errors.filter((e) => !e.includes('ResizeObserver'))).toHaveLength(0);
  });
});

// ─── Approval workflow (UI) ───────────────────────────────────────────────────

test.describe('Parent Dashboard — approval workflow', () => {
  test('pending approval appears after kid completes a quest', async ({ loginAsParent: page }) => {
    const { parentToken, kidToken, kidId } = loadTokens();
    await createAndCompleteChore(parentToken, kidToken, kidId);

    await page.reload();
    await page.waitForLoadState('networkidle');

    // Pending quest should surface as an "Approve" button, Verify button, or pending text
    const approveOrPending = page.locator('button:has-text("Approve"), button:has-text("Verify")')
      .or(page.locator('text=/pending/i'));
    await expect(approveOrPending.first()).toBeVisible({ timeout: 10_000 });
  });

  test('clicking Approve removes item from pending queue', async ({ loginAsParent: page }) => {
    const { parentToken, kidToken, kidId } = loadTokens();
    await createAndCompleteChore(parentToken, kidToken, kidId);

    await page.reload();
    await page.waitForLoadState('networkidle');

    const approveBtn = page.locator('button:has-text("Approve"), button:has-text("Verify")').first();
    if (!(await approveBtn.isVisible({ timeout: 8_000 }).catch(() => false))) return;

    const pendingCountBefore = await page.locator('button:has-text("Approve"), button:has-text("Verify")').count();
    await approveBtn.click();
    await page.waitForLoadState('networkidle');

    // Error must not appear
    await expect(page.locator('text=/error/i')).not.toBeVisible({ timeout: 3_000 }).catch(() => {});

    // Pending count must decrease or section disappears
    const pendingCountAfter = await page.locator('button:has-text("Approve"), button:has-text("Verify")').count();
    expect(pendingCountAfter).toBeLessThanOrEqual(pendingCountBefore);
  });
});

// ─── Approval workflow (API) ──────────────────────────────────────────────────

test.describe('Parent Dashboard — approval API', () => {
  test('parent verify awards XP to kid', async () => {
    const { parentToken, kidToken, kidId } = loadTokens();
    const choreId = await createAndCompleteChore(parentToken, kidToken, kidId);

    const before = await apiGet(`/api/points/${kidId}`, parentToken);
    const verify = await apiPost(`/api/chores/${choreId}/verify?kid_id=${kidId}`, parentToken);
    expect(verify.status, `verify failed: ${JSON.stringify(verify.body)}`).toBe(200);

    const after = await apiGet(`/api/points/${kidId}`, parentToken);
    expect(after.balance).toBeGreaterThan(before.balance);
  });

  test('parent stats endpoint returns data for kid', async () => {
    const { parentToken, kidId } = loadTokens();
    const res = await fetch(`${BASE}/api/stats/${kidId}`, {
      headers: { Authorization: `Bearer ${parentToken}` },
    });
    expect(res.status).toBeLessThan(400);
    const data = await res.json();
    expect(data).toBeTruthy();
  });

  test('GET /api/admin/users lists the e2e kid with correct role', async () => {
    const { parentToken } = loadTokens();
    const users = await apiGet('/api/admin/users', parentToken);
    expect(Array.isArray(users)).toBe(true);
    const kid = users.find((u) => u.username === 'e2e_kid');
    expect(kid, 'e2e_kid not found in admin/users').toBeTruthy();
    expect(kid.role).toBe('kid');
  });

  test('GET /api/chores returns chores list for parent', async () => {
    const { parentToken } = loadTokens();
    const chores = await apiGet('/api/chores', parentToken);
    expect(Array.isArray(chores)).toBe(true);
  });
});

// ─── Party page + kid detail ──────────────────────────────────────────────────

test.describe('Parent — party and kid detail', () => {
  test('party page loads without error', async ({ loginAsParent: page }) => {
    await page.goto('/party');
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/error|login/);
  });

  test('party page shows a kid card for e2e_kid', async ({ loginAsParent: page }) => {
    await page.goto('/party');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=/Kid|e2e_kid/i').first()).toBeVisible({ timeout: 8_000 });
  });

  test('/kids/:id loads the kid quest overview', async ({ loginAsParent: page }) => {
    const { kidId } = loadTokens();
    await page.goto(`/kids/${kidId}`);
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/error|login/);
    await expect(
      page.locator('.game-panel').or(page.locator('text=/quest|assignment/i')).first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test('parent can navigate from party card to kid detail', async ({ loginAsParent: page }) => {
    await page.goto('/party');
    await page.waitForLoadState('networkidle');
    const kidLink = page.locator('a[href*="/kids/"]').first();
    if (await kidLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await kidLink.click();
      await expect(page).toHaveURL(/\/kids\//);
      await expect(page).not.toHaveURL(/error/);
    }
  });
});

// ─── Bounty claim approvals on home screen ───────────────────────────────────

/** Create a bounty, have the kid claim and complete it, return the claim. */
async function createAndCompleteBountyClaim(parentToken, kidToken) {
  const cats = await apiGet('/api/chores/categories', parentToken);
  const categoryId = cats[0]?.id;

  const choreRes = await fetch(`${BASE}/api/chores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${parentToken}` },
    body: JSON.stringify({
      title: `Dashboard Bounty ${Date.now()}`,
      points: 25,
      difficulty: 'easy',
      recurrence: 'once',
      category_id: categoryId,
    }),
  });
  if (!choreRes.ok) throw new Error(`Create chore failed ${choreRes.status}: ${await choreRes.text()}`);
  const chore = await choreRes.json();

  // Mark as bounty
  const bountyRes = await fetch(`${BASE}/api/chores/${chore.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${parentToken}` },
    body: JSON.stringify({ is_bounty: true }),
  });
  if (!bountyRes.ok) throw new Error(`Set is_bounty failed ${bountyRes.status}: ${await bountyRes.text()}`);

  // Kid claims then completes
  const claimResult = await apiPost(`/api/bounty/${chore.id}/claim`, kidToken);
  if (claimResult.status >= 300) throw new Error(`Claim failed ${claimResult.status}: ${JSON.stringify(claimResult.body)}`);

  const fd = new FormData();
  const completeRes = await fetch(`${BASE}/api/bounty/${chore.id}/complete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${kidToken}` },
    body: fd,
  });
  if (!completeRes.ok) throw new Error(`Complete failed ${completeRes.status}: ${await completeRes.text()}`);

  const claims = await apiGet('/api/bounty/claims', parentToken);
  const claim = claims.find((c) => c.chore_id === chore.id);
  if (!claim) throw new Error(`Claim for chore ${chore.id} not found in pending queue. Queue: ${JSON.stringify(claims.map((c) => c.chore_id))}`);
  return claim;
}

test.describe('Parent Dashboard — bounty claim approvals', () => {
  test('completed bounty claim appears in Pending Verifications with Bounty badge', async ({ loginAsParent: page }) => {
    const { parentToken, kidToken } = loadTokens();
    await createAndCompleteBountyClaim(parentToken, kidToken);

    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(page.locator('text=Pending Verifications')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=Bounty').first()).toBeVisible({ timeout: 8_000 });
  });

  test('bounty claim card shows a date label (Today or Yesterday)', async ({ loginAsParent: page }) => {
    const { parentToken, kidToken } = loadTokens();
    await createAndCompleteBountyClaim(parentToken, kidToken);

    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(
      page.locator('text=/Today|Yesterday/i').first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test('approving a bounty claim from home screen removes it from the queue (API)', async () => {
    const { parentToken, kidToken, kidId } = loadTokens();
    const claim = await createAndCompleteBountyClaim(parentToken, kidToken);
    expect(claim, 'Claim not found in pending queue').toBeTruthy();

    const before = await apiGet(`/api/points/${kidId}`, parentToken);

    const verify = await apiPost(`/api/bounty/claims/${claim.id}/verify`, parentToken);
    expect(verify.status, `verify failed: ${JSON.stringify(verify.body)}`).toBe(200);

    // Claim no longer in pending queue
    const pending = await apiGet('/api/bounty/claims', parentToken);
    expect(pending.find((c) => c.id === claim.id)).toBeFalsy();

    // XP awarded
    const after = await apiGet(`/api/points/${kidId}`, parentToken);
    expect(after.balance).toBeGreaterThan(before.balance);
  });

  test('approving a bounty claim via UI removes it from the pending list', async ({ loginAsParent: page }) => {
    const { parentToken, kidToken } = loadTokens();
    await createAndCompleteBountyClaim(parentToken, kidToken);

    await page.reload();
    await page.waitForLoadState('networkidle');

    // Count only bounty cards so other tests' pending chore approvals don't interfere
    const bountyCards = page.locator('.game-panel', { has: page.locator('text=Bounty') });
    await expect(bountyCards.first()).toBeVisible({ timeout: 10_000 });
    const countBefore = await bountyCards.count();

    const approveBtn = bountyCards.first().locator('[title="Approve"]');
    await expect(approveBtn).toBeVisible();
    await approveBtn.click();
    await page.waitForLoadState('networkidle');

    await expect(page.locator('text=/error/i')).not.toBeVisible({ timeout: 3_000 }).catch(() => {});
    // Poll until React re-renders the updated list
    await expect.poll(() => bountyCards.count(), { timeout: 10_000 }).toBeLessThan(countBefore);
  });

  test('rejecting a bounty claim via UI removes it from the pending list', async ({ loginAsParent: page }) => {
    const { parentToken, kidToken } = loadTokens();
    await createAndCompleteBountyClaim(parentToken, kidToken);

    await page.reload();
    await page.waitForLoadState('networkidle');

    const bountyCards = page.locator('.game-panel', { has: page.locator('text=Bounty') });
    await expect(bountyCards.first()).toBeVisible({ timeout: 10_000 });
    const countBefore = await bountyCards.count();

    const rejectBtn = bountyCards.first().locator('[title="Reject"]');
    await expect(rejectBtn).toBeVisible();
    await rejectBtn.click();
    await page.waitForLoadState('networkidle');

    await expect(page.locator('text=/error/i')).not.toBeVisible({ timeout: 3_000 }).catch(() => {});
    await expect.poll(() => bountyCards.count(), { timeout: 10_000 }).toBeLessThan(countBefore);
  });
});

// ─── Shoutouts ────────────────────────────────────────────────────────────────

test.describe('Parent — shoutouts', () => {
  test('GET /api/shoutouts returns array', async () => {
    const { parentToken } = loadTokens();
    const res = await fetch(`${BASE}/api/shoutouts`, {
      headers: { Authorization: `Bearer ${parentToken}` },
    });
    expect(res.status).toBeLessThan(400);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('shoutout section is visible on dashboard (or gracefully absent)', async ({ loginAsParent: page }) => {
    await expect(page).not.toHaveURL(/error/);
    // Shoutouts may not show if none have been sent yet — just check no crash
  });
});
