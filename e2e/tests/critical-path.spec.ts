import { expect, test, type Page } from "@playwright/test";
import { SAMPLE_PHOTO_PNG, SEED_OWNER_EMAIL } from "../support/constants";
import { idFromUrl, submitAndWaitForApi } from "../support/wait";

/**
 * The Phase 18 critical path: the complete cross-role lifecycle from `docs/testing-plan.md`'s "E2E
 * critical path" section, run against the real app and a real (embedded) PostgreSQL database — see
 * `e2e/run.ts` for how both are stood up from an empty database before this file runs.
 *
 * This spec runs once per required viewport (see `e2e/playwright.config.ts`'s projects), all
 * against the same running app and database, so every piece of test data below is namespaced with
 * a per-project, per-run suffix. That is what lets four full copies of this lifecycle share one
 * organization without colliding on a location's access code, an employee number, or a SOP title.
 *
 * The manager (Owner) and employee actors share one browser context/page rather than separate
 * ones. Manager and employee sessions use separate cookies (see `src/server/auth/sessions.ts`), so
 * this still exercises the real session-type boundary on every request — it just avoids the added
 * complexity of juggling two contexts for a lifecycle that is inherently sequential anyway.
 */

const OWNER_PASSWORD = process.env["E2E_MANAGER_PASSWORD"];
if (!OWNER_PASSWORD) {
  throw new Error("E2E_MANAGER_PASSWORD must be set by e2e/run.ts before Playwright starts.");
}

interface Fixture {
  suffix: string;
  locationName: string;
  locationSlug: string;
  stationName: string;
  employeeNumber: string;
  employeePin: string;
  employeeName: string;
  sopTitle: string;
  qualificationName: string;
  pathTitle: string;
}

function buildFixture(projectName: string): Fixture {
  const suffix = `${projectName}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    suffix,
    locationName: `E2E ${suffix} Location`,
    locationSlug: `e2e-${suffix}`,
    stationName: `E2E ${suffix} Station`,
    employeeNumber: suffix.toUpperCase(),
    employeePin: "9137",
    employeeName: `E2E ${suffix} Employee`,
    sopTitle: `E2E ${suffix} Handwashing SOP`,
    qualificationName: `E2E ${suffix} Qualification`,
    pathTitle: `E2E ${suffix} Path`,
  };
}

async function loginAsOwner(page: Page): Promise<void> {
  await page.goto("/manager/login");
  await page.getByLabel("Email address").fill(SEED_OWNER_EMAIL);
  await page.getByLabel("Password").fill(OWNER_PASSWORD as string);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.includes("/login")),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);
}

async function createLocation(page: Page, fixture: Fixture): Promise<string> {
  await page.goto("/manager/settings/locations/new");
  await page.getByLabel("Location name").fill(fixture.locationName);
  await page.getByLabel("Employee access code").fill(fixture.locationSlug);
  await Promise.all([
    page.waitForURL(/\/manager\/settings\/locations\/[0-9a-f-]{36}$/),
    page.getByRole("button", { name: "Create location" }).click(),
  ]);
  return idFromUrl(page.url());
}

async function createStation(page: Page, fixture: Fixture): Promise<string> {
  await page.goto("/manager/settings/stations/new");
  await page.getByLabel("Location").selectOption({ label: fixture.locationName });
  await page.getByLabel("Station name").fill(fixture.stationName);
  await Promise.all([
    page.waitForURL(/\/manager\/settings\/stations\/[0-9a-f-]{36}$/),
    page.getByRole("button", { name: "Create station" }).click(),
  ]);
  return idFromUrl(page.url());
}

async function createEmployee(page: Page, fixture: Fixture): Promise<string> {
  await page.goto("/manager/employees/new");
  await page.getByLabel("Employee name").fill(fixture.employeeName);
  await page.getByLabel("Employee number").fill(fixture.employeeNumber);
  await page.getByLabel("Job role").fill("Cook");
  await page.getByLabel("Primary location").selectOption({ label: fixture.locationName });
  await page.getByLabel("Initial four-digit PIN").fill(fixture.employeePin);
  await Promise.all([
    page.waitForURL(/\/manager\/employees\/[0-9a-f-]{36}$/),
    page.getByRole("button", { name: "Create employee" }).click(),
  ]);
  return idFromUrl(page.url());
}

async function createSop(page: Page, fixture: Fixture): Promise<string> {
  await page.goto("/manager/sops/new");
  await page.getByLabel("Title").fill(fixture.sopTitle);
  await page.getByLabel("Category").selectOption({ label: "General Procedure" });
  await page.getByLabel("Location").selectOption({ label: fixture.locationName });
  await page.getByLabel("Station").selectOption({ label: fixture.stationName });
  await page
    .getByLabel("Description")
    .fill("A minimal end-to-end fixture procedure created by the Phase 18 automated suite.");
  await Promise.all([
    page.waitForURL(/\/manager\/sops\/[0-9a-f-]{36}\/steps$/),
    page.getByRole("button", { name: "Create draft and add steps" }).click(),
  ]);
  return idFromUrl(page.url());
}

async function addStep(page: Page): Promise<void> {
  // Already on the steps page after createSop's redirect.
  await page.getByRole("button", { name: "Add step" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Step title").fill("Wash hands");
  await dialog
    .getByLabel("Instruction")
    .fill("Wash your hands thoroughly for at least 20 seconds before starting the procedure.");
  await dialog.getByLabel("Required step").check();
  await submitAndWaitForApi(page, "/steps", () =>
    dialog.getByRole("button", { name: "Save step" }).click(),
  );
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Wash hands")).toBeVisible();
}

async function editStepInstruction(page: Page, sopId: string): Promise<void> {
  await page.goto(`/manager/sops/${sopId}/steps`);
  await page.getByRole("button", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Instruction")
    .fill(
      "Wash your hands thoroughly for at least 20 seconds, including under the fingernails, before starting the procedure.",
    );
  await submitAndWaitForApi(page, `/sops/${sopId}/steps/`, () =>
    dialog.getByRole("button", { name: "Save step" }).click(),
  );
  await expect(dialog).toBeHidden();
}

async function configureTraining(page: Page, sopId: string): Promise<void> {
  await page.goto(`/manager/sops/${sopId}/training`);
  await page.getByLabel("Requirement").selectOption({ label: "Required" });
  await page.getByLabel("Default mode").selectOption({ label: "Guided" });
  // Toggle's decorative track/thumb spans sit visually over the real (accessible) checkbox input,
  // so a plain click lands on the overlay rather than the input Playwright resolved; `force: true`
  // clicks the input directly rather than waiting on visual stability that will never resolve.
  await page
    .getByRole("switch", { name: "Require manager approval of submitted evidence" })
    .check({ force: true });
  await page.getByLabel("Passing score (%)").fill("0");
  await page.getByLabel("Maximum attempts").fill("3");
  await submitAndWaitForApi(page, `/sops/${sopId}/training`, () =>
    page.getByRole("button", { name: "Save training configuration" }).click(),
  );
  await expect(page.getByText("Training configuration saved.")).toBeVisible();

  await page
    .getByRole("switch", { name: "Require an explicit confirmation" })
    .check({ force: true });
  await page.getByRole("switch", { name: "Require photo evidence" }).check({ force: true });
  await page
    .getByRole("switch", { name: "Require manager approval", exact: true })
    .check({ force: true });
  await submitAndWaitForApi(page, "/training/steps/", () =>
    page.getByRole("button", { name: "Save step requirements" }).click(),
  );
}

async function addFinalQuestion(page: Page, sopId: string): Promise<void> {
  await page.goto(`/manager/sops/${sopId}/training/questions`);
  const finalQuestionsCard = page.locator(".card", { hasText: "Final questions" });
  await finalQuestionsCard.getByRole("button", { name: "Add question" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Question", { exact: true })
    .fill("Was the procedure followed correctly?");
  await dialog.getByLabel("Choice 1").fill("Yes");
  await dialog.getByLabel("Choice 2").fill("No");
  await submitAndWaitForApi(page, "/training/questions", () =>
    dialog.getByRole("button", { name: "Save question" }).click(),
  );
  await expect(dialog).toBeHidden();
}

async function publishSop(
  page: Page,
  sopId: string,
  update?: { changeSummary: string; retrainingRule: string },
): Promise<void> {
  await page.goto(`/manager/sops/${sopId}/publish`);
  if (update) {
    await page.getByLabel("What changed in this version").fill(update.changeSummary);
    await page.getByLabel("Retraining rule").selectOption({ label: update.retrainingRule });
  }
  await Promise.all([
    page.waitForURL(new RegExp(`/manager/sops/${sopId}$`)),
    page.getByRole("button", { name: "Publish SOP" }).click(),
  ]);
  await expect(page.getByText("published", { exact: true }).first()).toBeVisible();
}

async function createTrainingPath(page: Page, fixture: Fixture): Promise<void> {
  await page.goto("/manager/training/paths/new");
  await page.getByLabel("Title").fill(fixture.pathTitle);
  await page.getByLabel("Location").selectOption({ label: fixture.locationName });
  await page.getByLabel("Qualification name").fill(fixture.qualificationName);
  await page.getByLabel("Published SOP").selectOption({ label: fixture.sopTitle });
  await page.getByRole("button", { name: "Add to path" }).click();
  await Promise.all([
    page.waitForURL(/\/manager\/training\/paths\/[0-9a-f-]{36}$/),
    page.getByRole("button", { name: "Create path" }).click(),
  ]);
}

/** Returns the full scan URL text (e.g. `http://localhost:4310/q/{token}`) shown once at creation. */
async function createQrCode(page: Page, fixture: Fixture): Promise<string> {
  await page.goto("/manager/qr/new");
  await page.getByLabel("Location").selectOption({ label: fixture.locationName });
  await page.getByLabel("Points to").selectOption({ label: "Published SOP" });
  await page.getByLabel("SOP").selectOption({ label: fixture.sopTitle });
  await submitAndWaitForApi(page, "/api/management/qr", () =>
    page.getByRole("button", { name: "Create QR code" }).click(),
  );
  const scanLink = page.locator(".qr-print-card__url code");
  await expect(scanLink).toBeVisible();
  return (await scanLink.innerText()).trim();
}

async function assignTraining(
  page: Page,
  fixture: Fixture,
  employeeId: string,
  locationName: string,
): Promise<void> {
  await page.goto("/manager/training/assignments/new");
  await page
    .getByLabel("Published SOP")
    .selectOption({ label: `${fixture.sopTitle} · ${locationName}` });
  await page.locator(`#employee-${employeeId}`).check();
  await submitAndWaitForApi(page, "/api/management/training/assignments", () =>
    page.getByRole("button", { name: "Assign training" }).click(),
  );
  await expect(page.getByText(/1 assignment created\./)).toBeVisible();
}

async function loginAsEmployeeViaQr(page: Page, scanUrl: string, fixture: Fixture): Promise<void> {
  await page.goto(scanUrl);
  await page.waitForURL(/\/employee\/login/);
  await page.getByLabel("Employee number").fill(fixture.employeeNumber);
  await page.getByLabel("Four-digit PIN").fill(fixture.employeePin);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.includes("/login")),
    page.getByRole("button", { name: "Open StationSnap" }).click(),
  ]);
}

/** Starts (or resumes) the employee's assignment for `sopTitle` and runs it to submission. */
async function completeGuidedTraining(page: Page, sopTitle: string): Promise<void> {
  await page.goto("/employee/training");
  // A retraining pass has two cards for the same SOP title: the earlier completed attempt and the
  // new assignment. Only the not-yet-completed one is still actionable here.
  await page
    .getByRole("link", { name: new RegExp(sopTitle) })
    .filter({ hasNotText: "completed" })
    .click();

  const startButton = page.getByRole("button", { name: /Start (training|next attempt)/ });
  const resumeLink = page.getByRole("link", { name: "Continue where you left off" });
  if (await resumeLink.isVisible().catch(() => false)) {
    await resumeLink.click();
  } else {
    await Promise.all([page.waitForURL(/\/session\/[0-9a-f-]{36}$/), startButton.click()]);
  }

  await page.getByRole("button", { name: "Confirm this step" }).click();
  await expect(page.getByRole("button", { name: "Confirmed" })).toBeVisible();

  const evidenceInput = page.getByLabel(/Upload a photo as proof/i);
  await evidenceInput.setInputFiles({
    name: "evidence.png",
    mimeType: "image/png",
    buffer: SAMPLE_PHOTO_PNG,
  });
  await expect(page.getByText(/submission.*uploaded\./)).toBeVisible();

  await page.getByLabel("Yes").check();
  await submitAndWaitForApi(page, "/answers/", () =>
    page.getByRole("button", { name: "Submit answer" }).click(),
  );

  await Promise.all([
    page.waitForURL(/\/result$/),
    page.getByRole("button", { name: "Submit training" }).click(),
  ]);
  await expect(page.getByText("Waiting on manager review")).toBeVisible();
}

async function approveLatestSubmission(page: Page, employeeName: string): Promise<void> {
  await page.goto("/manager/training/approvals");
  await page
    .getByRole("link", { name: new RegExp(employeeName) })
    .first()
    .click();
  await page.getByLabel("Approve").check();
  await submitAndWaitForApi(page, "/decide", () =>
    page.getByRole("button", { name: "Approve", exact: true }).click(),
  );
}

async function expectQualificationEarned(page: Page, qualificationName: string): Promise<void> {
  await page.goto("/employee/qualifications");
  await expect(page.getByText(qualificationName)).toBeVisible();
  await expect(page.getByText(/Awarded /)).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("owner setup through publish, QR, assignment, guided completion, approval, qualification award, and retraining", async ({
  page,
}, testInfo) => {
  const fixture = buildFixture(testInfo.project.name);

  await test.step("Owner setup: log in, create a location, station, and employee", async () => {
    await loginAsOwner(page);
    await createLocation(page, fixture);
    await createStation(page, fixture);
  });

  const employeeId = await test.step("Create the employee who will train", async () =>
    createEmployee(page, fixture));

  const sopId =
    await test.step("SOP creation: draft, step, training config, question", async () => {
      const id = await createSop(page, fixture);
      await addStep(page);
      await configureTraining(page, id);
      await addFinalQuestion(page, id);
      return id;
    });

  await test.step("Publish the SOP", async () => {
    await publishSop(page, sopId);
  });

  await test.step("Build the training path that awards a qualification", async () => {
    await createTrainingPath(page, fixture);
  });

  const scanUrl = await test.step("QR creation", async () => createQrCode(page, fixture));

  await test.step("Assignment: assign the published SOP to the new employee", async () => {
    await assignTraining(page, fixture, employeeId, fixture.locationName);
  });

  await test.step("Employee PIN login via the QR scan link", async () => {
    await loginAsEmployeeViaQr(page, scanUrl, fixture);
  });

  await test.step("Employee Guided completion with evidence and a quiz question", async () => {
    await completeGuidedTraining(page, fixture.sopTitle);
  });

  await test.step("Manager approval", async () => {
    await approveLatestSubmission(page, fixture.employeeName);
  });

  await test.step("Qualification award", async () => {
    await expectQualificationEarned(page, fixture.qualificationName);
  });

  await test.step("SOP update: new draft, edited step, publish with a retraining rule", async () => {
    await page.goto(`/manager/sops/${sopId}`);
    await page.getByRole("button", { name: "Start a new draft" }).click();
    await page.waitForURL(new RegExp(`/manager/sops/${sopId}/edit$`));
    await editStepInstruction(page, sopId);
    await publishSop(page, sopId, {
      changeSummary: "Clarified handwashing instructions.",
      retrainingRule: "Retrain everyone currently qualified on this SOP",
    });
  });

  await test.step("Retraining: assign the updated version to the same employee", async () => {
    await assignTraining(page, fixture, employeeId, fixture.locationName);
  });

  await test.step("Employee retraining: complete and get re-approved", async () => {
    await completeGuidedTraining(page, fixture.sopTitle);
    await approveLatestSubmission(page, fixture.employeeName);
    await expectQualificationEarned(page, fixture.qualificationName);
  });
});
