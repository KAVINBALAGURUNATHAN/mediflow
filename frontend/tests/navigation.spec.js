import { test, expect } from '@playwright/test';
import {
  connect,
  disconnect,
  actors,
  loginAs,
  signPatient,
  signReceptionist,
  Hospital,
  Doctor,
} from './helpers/backend.js';

// Who sees which navigation.
//
// Staff sign-in IS in the public header - staff need an obvious way in - but
// as a single secondary text link to the /staff-login role chooser, not the
// four-role dropdown it used to be. What these assert is the hierarchy:
// Patient Portal stays the primary button, Staff Login stays plain text, and
// no staff DASHBOARD ever appears in the public bar. Every role's login page
// is checked to still be reachable and to still authenticate.
test.describe('navigation by audience', () => {
  let patient;
  let receptionist;

  test.beforeAll(async () => {
    await connect();
    ({ patient, receptionist } = await actors());
  });

  test.afterAll(async () => {
    await disconnect();
  });

  // The patient guard checks for the stored profile as well as the token
  // (see PatientProtectedRoute.jsx), so seeding only the token silently
  // bounces to the login page.
  async function loginAsPatient(page, who) {
    await loginAs(page, 'patientToken', signPatient(who._id));
    await page.addInitScript(
      (profile) => window.localStorage.setItem('patient', profile),
      JSON.stringify({ _id: String(who._id), name: who.name, phone: who.phone })
    );
  }

  const PUBLIC_PAGES = [
    ['/', 'Home'],
    ['/departments', 'Departments'],
    ['/health-packages', 'Health Packages'],
    ['/emergency', 'Emergency'],
    ['/contact', 'Contact'],
  ];

  test('an unauthenticated visitor can reach every public page', async ({
    page,
  }) => {
    for (const [path] of PUBLIC_PAGES) {
      const response = await page.goto(path);
      expect(response.status(), `${path} should load`).toBeLessThan(400);

      // Not an error boundary or a redirect to a login.
      await expect(page.locator('header').first()).toBeVisible({
        timeout: 15_000,
      });
      expect(page.url()).not.toContain('login');
    }
  });

  test('the public header ranks Patient Portal above Staff Login', async ({
    page,
  }) => {
    await page.goto('/');

    const header = page.locator('header').first();
    await expect(header).toBeVisible({ timeout: 15_000 });

    for (const [, label] of PUBLIC_PAGES.slice(1)) {
      await expect(
        header.getByRole('link', { name: label, exact: true })
      ).toBeVisible();
    }

    // The primary action, and a button.
    const portal = header.getByRole('button', { name: 'Patient Portal' });
    await expect(portal).toBeVisible();

    // Present, but secondary: a link rather than a button, and not styled as
    // one. If this ever becomes a button or picks up the primary background,
    // the hierarchy the task asked for has been lost.
    const staff = header.getByRole('link', { name: 'Staff Login' });
    await expect(staff).toBeVisible();

    await expect(
      await staff.evaluate((el) => el.className),
      'Staff Login must not borrow the primary button styling'
    ).not.toMatch(/btn-primary|bg-primary/);

    await expect(
      await portal.evaluate((el) => el.className),
      'Patient Portal must stay the primary button'
    ).toMatch(/btn-primary/);

    // Staff DASHBOARDS still never appear in a public bar - only the login.
    for (const leaked of [
      /admin dashboard/i,
      /reception dashboard/i,
      /live queue/i,
      /clinical preparation/i,
    ]) {
      await expect(header.getByText(leaked)).toHaveCount(0);
    }
  });

  test('Staff Login in the header opens the existing staff login page', async ({
    page,
  }) => {
    await page.goto('/');

    await page
      .locator('header')
      .first()
      .getByRole('link', { name: 'Staff Login' })
      .click();

    // The route that already existed - no new auth surface was added.
    await expect(page).toHaveURL(/\/staff-login$/);
    await expect(
      page.getByRole('heading', { name: /staff login/i })
    ).toBeVisible();
  });

  test('staff login is still reachable, from the footer and by URL', async ({
    page,
  }) => {
    await page.goto('/');

    const footerLink = page
      .locator('footer')
      .getByRole('link', { name: /staff login/i });

    await expect(
      footerLink,
      'demoted, not deleted - staff still need a way in'
    ).toBeVisible({ timeout: 15_000 });

    await footerLink.click();
    await expect(page).toHaveURL(/\/staff-login$/);

    // Every role, including the nurse - who previously had no linked entry
    // point anywhere in the app. Matched on the visible label rather than the
    // button's accessible name, which also swallows the description
    // underneath ("Administrator / Doctors, staff, branches...").
    for (const role of ['Doctor', 'Reception', 'Nurse', 'Administrator']) {
      await expect(page.getByText(role, { exact: true })).toBeVisible();
    }

    await page.getByText('Reception', { exact: true }).click();
    await expect(page).toHaveURL(/\/receptionist-login$/);
    await expect(
      page.getByRole('heading', { name: /reception login/i })
    ).toBeVisible();
  });

  test('every staff login page still loads directly', async ({ page }) => {
    for (const path of [
      '/doctor-login',
      '/receptionist-login',
      '/nurse-login',
      '/admin-login',
    ]) {
      const response = await page.goto(path);
      expect(response.status(), `${path} should load`).toBeLessThan(400);
      await expect(page.getByLabel('Email')).toBeVisible({ timeout: 15_000 });
    }
  });

  test('staff authentication still gates the staff pages', async ({ page }) => {
    // Unauthenticated: bounced to the role's own login.
    await page.goto('/receptionist');
    await expect(page).toHaveURL(/receptionist-login/, { timeout: 15_000 });

    // Authenticated with a real receptionist token: the dashboard opens, and
    // the sidebar shows the receptionist's own nav.
    await loginAs(
      page,
      'receptionistToken',
      signReceptionist(receptionist._id)
    );
    await page.goto('/receptionist');

    await expect(
      page.getByRole('link', { name: /reception dashboard/i })
    ).toBeVisible({ timeout: 15_000 });
  });

  test('a signed-in patient sees patient navigation, not staff navigation', async ({
    page,
  }) => {
    // PatientProtectedRoute requires the stored profile as well as the
    // token, because the portal pages read the patient's name from it.
    await loginAsPatient(page, patient);
    await page.goto('/patient-dashboard');

    const nav = page.getByRole('navigation', { name: /main navigation/i });
    await expect(nav).toBeVisible({ timeout: 15_000 });

    for (const label of [
      'Dashboard',
      'Book Appointment',
      'My Appointments',
      'Prescriptions',
      'Lab Results',
      'Profile',
    ]) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible();
    }

    // Nothing internal leaks into the portal.
    await expect(nav.getByText(/staff login/i)).toHaveCount(0);
    await expect(nav.getByText(/doctor login/i)).toHaveCount(0);
    await expect(nav.getByText(/reception/i)).toHaveCount(0);
    await expect(nav.getByText(/admin/i)).toHaveCount(0);
    await expect(nav.getByText(/live queue/i)).toHaveCount(0);

    await expect(page.getByRole('button', { name: /log ?out/i })).toBeVisible();
  });

  test('Find a Doctor still works, with its search and filters intact', async ({
    page,
  }) => {
    // /doctors is branch-scoped and blocks on "Finding your branch..." until
    // one is chosen. A headless browser has no geolocation, so the branch is
    // seeded the way a returning visitor's browser would already hold it.
    // This is existing behaviour, not something the nav change introduced.
    const hospital = await Hospital.findOne().lean();
    test.skip(!hospital, 'no hospital branch is configured');

    await page.addInitScript(
      (branch) => window.localStorage.setItem('selectedBranch', branch),
      JSON.stringify(hospital)
    );

    await page.goto('/doctors');

    // The task was explicit that this page is not the problem - doctor
    // discovery is exactly what a new patient needs.
    await expect(page.locator('header').first()).toBeVisible({
      timeout: 15_000,
    });

    // Rendered once the doctor list has loaded, so it needs the same
    // tolerance as any other data-backed control here.
    await expect(
      page.getByLabel('Search doctors'),
      'doctor search must survive the nav change'
    ).toBeVisible({ timeout: 15_000 });

    // Specialty/department filtering is still offered.
    await expect(
      page.getByText(/search by name or specialty/i),
      'specialty filtering must survive the nav change'
    ).toBeVisible();
  });

  test('the booking flow keeps ONE header from Find a Doctor to Confirmed', async ({
    page,
  }) => {
    // The bug: /doctors rendered the public header while /book/:id fell
    // through to the Sidebar/Header dashboard chrome, so the navigation
    // changed halfway through booking. Deleting the shared header from the
    // booking pages was the wrong fix - it is the same component the public
    // site uses, so it vanished from Home/Departments too.
    const hospital = await Hospital.findOne().lean();
    test.skip(!hospital, 'no hospital branch is configured');

    await page.addInitScript(
      (branch) => window.localStorage.setItem('selectedBranch', branch),
      JSON.stringify(hospital)
    );
    await loginAsPatient(page, patient);

    const doctor = await Doctor.findOne({ isAvailable: true });
    test.skip(!doctor, 'no available doctor to book with');

    for (const path of ['/doctors', `/book/${doctor._id}`]) {
      await page.goto(path);

      const header = page.locator('header').first();
      await expect(header, `${path} should carry the public header`).toBeVisible({
        timeout: 15_000,
      });

      // The same header, not a second one and not the dashboard chrome.
      await expect(page.locator('header')).toHaveCount(1);
      await expect(
        header.getByRole('button', { name: 'Patient Portal' }),
        `${path} should offer the patient their portal`
      ).toBeVisible();
      await expect(
        page.getByRole('navigation', { name: /main navigation/i }),
        `${path} must not also show the dashboard sidebar`
      ).toHaveCount(0);
    }
  });

  test('the shared header is still on the public pages', async ({ page }) => {
    // The other half of the same bug: whatever the booking flow does, the
    // public site must keep its header.
    for (const [path] of PUBLIC_PAGES) {
      await page.goto(path);
      await expect(
        page.locator('header').first(),
        `${path} lost its header`
      ).toBeVisible({ timeout: 15_000 });
    }
  });

  test('a new patient can still browse departments and reach booking', async ({
    page,
  }) => {
    await page.goto('/departments');
    await expect(page.locator('header').first()).toBeVisible({
      timeout: 15_000,
    });

    // Booking is a protected route: a guest is sent to sign in rather than
    // silently shown an empty form. That redirect IS the booking flow's
    // entry check, so it must keep working.
    await page.goto('/my-appointments');
    await expect(page).toHaveURL(/patient-login/, { timeout: 15_000 });
  });
});
