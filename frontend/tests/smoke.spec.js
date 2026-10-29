import { test, expect } from '@playwright/test';

test.describe('smoke', () => {
  test('MediFlow opens', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/mediflow/i);
  });

  test('the landing page renders its own content, not an error boundary', async ({
    page,
  }) => {
    const failures = [];
    page.on('pageerror', (err) => failures.push(err.message));

    await page.goto('/');
    await expect(page.locator('body')).toContainText(/mediflow/i);

    // A React app that throws during render still returns HTTP 200 with a
    // valid title, so the title assertion above cannot catch it on its own.
    expect(failures, 'uncaught errors on the landing page').toEqual([]);
  });

  test('the staff login pages are reachable', async ({ page }) => {
    for (const path of ['/doctor-login', '/receptionist-login']) {
      await page.goto(path);
      await expect(
        page.getByRole('textbox').first(),
        `${path} should render a login form`
      ).toBeVisible();
    }
  });

  test('a staff page cannot be opened without signing in', async ({ page }) => {
    await page.goto('/dashboard');

    // The guard must send an unauthenticated visitor to a login screen rather
    // than rendering the dashboard shell and leaving it empty.
    await expect(page).toHaveURL(/login/i);
  });
});
