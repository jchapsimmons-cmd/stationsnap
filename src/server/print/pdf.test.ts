// @vitest-environment node
//
// pdf-parse's underlying pdf.js build detects its runtime by inspecting global objects, and
// picks its browser/worker code path under jsdom (which defines `window`/`document`) instead of
// the plain-Node path that works without a configured PDF.js worker. Forcing the real Node
// environment for this file keeps text extraction fast and dependency-free.
import pdfParse from "pdf-parse";
import { describe, expect, it } from "vitest";
import {
  renderChecklistRunPdf,
  renderQualificationPdf,
  renderSopVersionPdf,
  renderTrainingSessionPdf,
} from "@/server/print/pdf";

async function extractText(bytes: Uint8Array): Promise<string> {
  const result = await pdfParse(Buffer.from(bytes));
  return result.text;
}

describe("renderSopVersionPdf", () => {
  it("produces a valid PDF whose extracted text includes the immutable version content", async () => {
    const bytes = await renderSopVersionPdf({
      sopTitle: "Grill Station Sear",
      versionNumber: 3,
      status: "published",
      category: "recipe",
      difficulty: "intermediate",
      estimatedMinutes: 12,
      changeSummary: "Adjusted sear time",
      publishedAt: new Date("2026-01-01T00:00:00Z"),
      locationName: "Downtown",
      stationName: "Grill",
      materials: [{ kind: "ingredient", name: "Ribeye steak", quantity: "8", unit: "oz" }],
      warnings: [{ text: "Surface reaches 450°F" }],
      steps: [
        {
          displayOrder: 1,
          title: "Preheat",
          instruction: "Preheat the grill to high heat.",
          quantity: null,
          unit: null,
          equipmentSetting: "High",
          timerSeconds: 300,
          warning: null,
          isRequired: true,
        },
      ],
    });

    expect(Buffer.from(bytes).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const text = await extractText(bytes);
    expect(text).toContain("Grill Station Sear");
    expect(text).toContain("Ribeye steak");
    expect(text).toContain("Surface reaches 450");
    expect(text).toContain("Preheat the grill to high heat.");
  });

  it("spills a long step list onto additional pages rather than truncating it", async () => {
    const steps = Array.from({ length: 60 }, (_, index) => ({
      displayOrder: index + 1,
      title: `Step title ${index + 1}`,
      instruction: `Detailed instruction text for step number ${index + 1} of this long SOP.`,
      quantity: null,
      unit: null,
      equipmentSetting: null,
      timerSeconds: null,
      warning: null,
      isRequired: true,
    }));
    const bytes = await renderSopVersionPdf({
      sopTitle: "Long Procedure",
      versionNumber: 1,
      status: "published",
      category: "cleaning",
      difficulty: "beginner",
      estimatedMinutes: null,
      changeSummary: "",
      publishedAt: null,
      locationName: "Riverside",
      stationName: null,
      materials: [],
      warnings: [],
      steps,
    });
    const doc = await pdfParse(Buffer.from(bytes));
    expect(doc.numpages).toBeGreaterThan(1);
    const text = await extractText(bytes);
    expect(text).toContain("Step title 1");
    expect(text).toContain("Step title 60");
  });
});

describe("renderTrainingSessionPdf", () => {
  it("includes employee, score, and evidence details in the extracted text", async () => {
    const bytes = await renderTrainingSessionPdf({
      employeeName: "Jamie Rivera",
      employeeNumber: "1042",
      locationName: "Downtown",
      sopTitle: "Grill Station Sear",
      sopVersionNumber: 3,
      mode: "guided",
      attemptNumber: 1,
      sessionStatus: "passed",
      assignmentStatus: "completed",
      scorePercent: 92,
      passingScorePercent: 80,
      startedAt: new Date("2026-01-01T00:00:00Z"),
      submittedAt: new Date("2026-01-01T00:20:00Z"),
      completedAt: new Date("2026-01-01T00:21:00Z"),
      quizTotalQuestions: 4,
      quizCorrectAnswers: 4,
      evidence: [
        {
          stepTitle: "Preheat",
          evidenceType: "photo",
          employeeNote: "Grill at temp",
          createdAt: new Date("2026-01-01T00:10:00Z"),
        },
      ],
      latestDecision: {
        decision: "approved",
        note: "Looks good",
        decidedByName: "Morgan Lee",
        decidedAt: new Date("2026-01-01T00:22:00Z"),
      },
    });

    const text = await extractText(bytes);
    expect(text).toContain("Jamie Rivera");
    expect(text).toContain("92%");
    expect(text).toContain("Morgan Lee");
    expect(text).toContain("Grill at temp");
  });
});

describe("renderQualificationPdf", () => {
  it("includes the definition, status, and supporting completions", async () => {
    const bytes = await renderQualificationPdf({
      employeeName: "Jamie Rivera",
      employeeNumber: "1042",
      locationName: "Downtown",
      definitionName: "Grill Station Qualified",
      definitionDescription: "Certified to operate the grill station unsupervised.",
      pathTitle: "Grill Path",
      status: "active",
      awardedAt: new Date("2026-01-01T00:00:00Z"),
      expiresAt: new Date("2027-01-01T00:00:00Z"),
      isExpired: false,
      revokedAt: null,
      revokedNote: null,
      supportingSessions: [
        {
          sopTitle: "Grill Station Sear",
          sopVersionNumber: 3,
          completedAt: new Date("2026-01-01T00:21:00Z"),
        },
      ],
    });

    const text = await extractText(bytes);
    expect(text).toContain("Grill Station Qualified");
    expect(text).toContain("Certified to operate the grill station unsupervised.");
    expect(text).toContain("Grill Station Sear");
  });
});

describe("renderChecklistRunPdf", () => {
  it("marks completed items and includes employee notes", async () => {
    const bytes = await renderChecklistRunPdf({
      checklistTitle: "Opening checklist",
      checklistType: "opening",
      employeeName: "Jamie Rivera",
      employeeNumber: "1042",
      locationName: "Downtown",
      status: "completed",
      startedAt: new Date("2026-01-01T06:00:00Z"),
      submittedAt: new Date("2026-01-01T06:20:00Z"),
      completedAt: new Date("2026-01-01T06:21:00Z"),
      items: [
        {
          displayOrder: 1,
          title: "Unlock doors",
          isRequired: true,
          isDone: true,
          employeeNote: "",
        },
        {
          displayOrder: 2,
          title: "Check walk-in temperature",
          isRequired: true,
          isDone: false,
          employeeNote: "Thermometer missing",
        },
      ],
    });

    const text = await extractText(bytes);
    expect(text).toContain("Opening checklist");
    expect(text).toContain("Unlock doors");
    expect(text).toContain("Thermometer missing");
  });
});
