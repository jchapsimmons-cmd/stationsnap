import { describe, expect, it } from "vitest";
import {
  approvalHistoryReportToCsv,
  checklistCompletionReportToCsv,
  qualificationsReportToCsv,
  sopVersionHistoryReportToCsv,
  trainingProgressReportToCsv,
} from "@/server/print/csv-export";

describe("trainingProgressReportToCsv", () => {
  it("renders one row per assignment with the reported fields", () => {
    const csv = trainingProgressReportToCsv([
      {
        id: "a1",
        status: "completed",
        requiredMode: "guided",
        dueAt: new Date("2026-02-01T00:00:00Z"),
        employeeId: "e1",
        employeeName: "Jamie Rivera",
        locationId: "l1",
        locationName: "Downtown",
        sopId: "s1",
        sopTitle: "Grill Station Sear",
        versionNumber: 3,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-05T00:00:00Z"),
      },
    ]);
    expect(csv).toBe(
      "Employee,SOP,Version,Location,Status,Due,Updated\r\n" +
        "Jamie Rivera,Grill Station Sear,3,Downtown,completed,2026-02-01T00:00:00.000Z,2026-01-05T00:00:00.000Z\r\n",
    );
  });

  it("renders an empty due date as an empty cell", () => {
    const csv = trainingProgressReportToCsv([
      {
        id: "a1",
        status: "assigned",
        requiredMode: "test",
        dueAt: null,
        employeeId: "e1",
        employeeName: "Jamie Rivera",
        locationId: "l1",
        locationName: "Downtown",
        sopId: "s1",
        sopTitle: "Grill Station Sear",
        versionNumber: 1,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
    expect(csv).toContain(",,2026-01-01T00:00:00.000Z\r\n");
  });

  it("defuses an employee display name that looks like a spreadsheet formula", () => {
    const csv = trainingProgressReportToCsv([
      {
        id: "a1",
        status: "assigned",
        requiredMode: "learn",
        dueAt: null,
        employeeId: "e1",
        employeeName: '=HYPERLINK("http://evil")',
        locationId: "l1",
        locationName: "Downtown",
        sopId: "s1",
        sopTitle: "Grill Station Sear",
        versionNumber: 1,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
    expect(csv).toContain("'=HYPERLINK");
  });
});

describe("qualificationsReportToCsv", () => {
  it("renders classification and expiring-soon columns", () => {
    const csv = qualificationsReportToCsv([
      {
        definitionId: "d1",
        definitionName: "Grill Station Qualified",
        locationId: "l1",
        locationName: "Downtown",
        pathId: "p1",
        pathTitle: "Grill Path",
        employeeId: "e1",
        employeeName: "Jamie Rivera",
        employeeNumber: "1042",
        classification: "qualified",
        isExpiringSoon: true,
        qualificationId: "q1",
        awardedAt: new Date("2026-01-01T00:00:00Z"),
        expiresAt: new Date("2026-03-01T00:00:00Z"),
      },
    ]);
    expect(csv).toContain(
      "Jamie Rivera,1042,Grill Station Qualified,Grill Path,Downtown,qualified,yes,",
    );
  });
});

describe("checklistCompletionReportToCsv", () => {
  it("renders lifecycle timestamps for each run", () => {
    const csv = checklistCompletionReportToCsv([
      {
        id: "r1",
        status: "submitted",
        startedAt: new Date("2026-01-01T06:00:00Z"),
        submittedAt: new Date("2026-01-01T06:20:00Z"),
        completedAt: new Date("2026-01-01T06:21:00Z"),
        checklistId: "c1",
        checklistTitle: "Opening checklist",
        checklistType: "opening",
        employeeId: "e1",
        employeeName: "Jamie Rivera",
        locationId: "l1",
        locationName: "Downtown",
        updatedAt: new Date("2026-01-01T06:21:00Z"),
      },
    ]);
    expect(csv).toContain("Opening checklist,opening,Jamie Rivera,Downtown,submitted,");
  });
});

describe("approvalHistoryReportToCsv", () => {
  it("defuses a manager note that starts with a formula-trigger character", () => {
    const csv = approvalHistoryReportToCsv([
      {
        id: "d1",
        kind: "training",
        decision: "rejected",
        note: "=cmd|'/c calc'!A1",
        decidedAt: new Date("2026-01-01T00:00:00Z"),
        decidedByName: "Morgan Lee",
        employeeName: "Jamie Rivera",
        subjectTitle: "Grill Station Sear",
        locationId: "l1",
        locationName: "Downtown",
      },
    ]);
    expect(csv).toContain("'=cmd|'/c calc'!A1");
  });
});

describe("sopVersionHistoryReportToCsv", () => {
  it("renders publication history rows", () => {
    const csv = sopVersionHistoryReportToCsv([
      {
        id: "v1",
        sopId: "s1",
        versionNumber: 3,
        status: "published",
        title: "Grill Station Sear",
        category: "recipe",
        changeSummary: "Adjusted sear time",
        publishedAt: new Date("2026-01-01T00:00:00Z"),
        publishedByManagerUserId: "m1",
        locationId: "l1",
        locationName: "Downtown",
        createdAt: new Date("2025-12-01T00:00:00Z"),
      },
    ]);
    expect(csv).toContain("Grill Station Sear,3,published,recipe,Downtown,Adjusted sear time,");
  });
});
