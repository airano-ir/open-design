import { expect } from '@playwright/test';
import type { Locator } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * The entry nav rail is collapsed by default; its destinations
 * (`entry-nav-*`) only become interactable once the rail is expanded. The
 * expand affordance is the pinned Home tab's sidebar toggle in the workspace
 * tabs bar (#5517 removed the entry topbar) — it only renders on the Home
 * view; on any other entry view the pinned tab is a Home shortcut instead,
 * so this helper returns Home first when it needs to expand. Idempotent —
 * no-ops when the rail is already docked open.
 */
export async function ensureRailOpen(page: Page): Promise<void> {
  const shell = page.locator('.entry');
  const alreadyOpen = await shell
    .evaluate((el) => el.classList.contains('entry--rail-open'))
    .catch(() => false);
  if (!alreadyOpen) {
    const toggle = page.getByTestId('workspace-home-rail-toggle');
    if (!(await toggle.isVisible().catch(() => false))) {
      const homeNav = page.getByTestId('workspace-home-nav');
      if (await homeNav.isVisible().catch(() => false)) {
        await homeNav.click();
      }
    }
    await expect(toggle).toBeVisible();
    await toggle.click();
  }
  await expect(page.locator('.entry')).toHaveClass(/entry--rail-open/);
  await expect(page.locator('.entry-nav-rail')).not.toHaveAttribute('aria-hidden', 'true');
}

export async function openNewProjectModal(page: Page): Promise<void> {
  if (await page.getByTestId('new-project-panel').isVisible().catch(() => false)) return;
  await ensureRailOpen(page);
  const railCreateButton = page.getByTestId('entry-nav-new-project');
  if (await railCreateButton.isVisible().catch(() => false)) {
    const point = await getActionablePoint(railCreateButton);
    if (point) {
      await page.mouse.click(point.x, point.y);
      await expect(page.getByTestId('new-project-modal')).toBeVisible();
      await expect(page.getByTestId('new-project-panel')).toBeVisible();
      return;
    }
  }

  const projectsNav = page.getByTestId('entry-nav-projects');
  if (await projectsNav.isVisible().catch(() => false)) {
    await projectsNav.scrollIntoViewIfNeeded();
    await projectsNav.click();
  } else if (!/\/projects$/.test(new URL(page.url()).pathname)) {
    await page.goto('/projects', { waitUntil: 'domcontentloaded' });
  }
  const projectsView = page.getByTestId('entry-view-projects');
  await expect(projectsView).toBeVisible();
  const createButton = projectsView
    .getByTestId('designs-new-project')
    .or(projectsView.getByTestId('designs-empty-new-project'))
    .first();
  await expect(createButton).toBeVisible();
  await createButton.click();
  await expect(page.getByTestId('new-project-modal')).toBeVisible();
  await expect(page.getByTestId('new-project-panel')).toBeVisible();
}

async function getActionablePoint(locator: Locator): Promise<{ x: number; y: number } | null> {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    if (
      point.x < 0 ||
      point.y < 0 ||
      point.x > window.innerWidth ||
      point.y > window.innerHeight
    ) {
      return null;
    }
    const hit = document.elementFromPoint(point.x, point.y);
    return hit && element.contains(hit) ? point : null;
  }).catch(() => null);
}
