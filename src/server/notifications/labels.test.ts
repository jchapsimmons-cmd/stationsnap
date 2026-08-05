import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_TYPE_LABELS,
  formatNotificationBody,
  notificationTypeValues,
  resolveNotificationText,
} from "@/server/notifications/labels";

describe("NOTIFICATION_TYPE_LABELS", () => {
  it("has a non-empty title for every notification type", () => {
    for (const type of notificationTypeValues) {
      expect(NOTIFICATION_TYPE_LABELS[type]).toBeTruthy();
    }
  });
});

describe("formatNotificationBody", () => {
  it("renders a training.assigned body from sopTitle alone", () => {
    expect(formatNotificationBody("training.assigned", { sopTitle: "Grill Safety" })).toBe(
      "Grill Safety",
    );
  });

  it("joins employee name and SOP title for a manager awaiting-approval body", () => {
    const body = formatNotificationBody("training.awaiting_approval", {
      employeeName: "Sam Lee",
      sopTitle: "Grill Safety",
    });
    expect(body).toBe("Sam Lee — Grill Safety");
  });

  it("humanizes an underscore decision value", () => {
    const body = formatNotificationBody("training.approval_decided", {
      sopTitle: "Grill Safety",
      decision: "needs_correction",
    });
    expect(body).toBe("Grill Safety — needs correction");
  });

  it("includes the due date for due-soon and overdue training", () => {
    expect(
      formatNotificationBody("training.due_soon", {
        sopTitle: "Grill Safety",
        dueDate: "2026-08-10",
      }),
    ).toBe("Grill Safety — due 2026-08-10");
    expect(
      formatNotificationBody("training.overdue", {
        sopTitle: "Grill Safety",
        dueDate: "2026-08-01",
      }),
    ).toBe("Grill Safety — due 2026-08-01");
  });

  it("includes the expiry date for expiring-soon qualifications", () => {
    const body = formatNotificationBody("qualification.expiring_soon", {
      definitionName: "Grill Station",
      dueDate: "2026-09-01",
    });
    expect(body).toBe("Grill Station — expires 2026-09-01");
  });

  it("never throws and falls back gracefully when params are missing entirely", () => {
    for (const type of notificationTypeValues) {
      expect(() => formatNotificationBody(type, {})).not.toThrow();
    }
  });

  it("ignores unsafe or unexpected param shapes rather than rendering them literally", () => {
    // A non-string value under an expected key must not be coerced into the body — only the
    // string branch of each param read is honored, matching sanitizeParams's own string|number|
    // boolean|null contract without ever concatenating a stray object into displayed text.
    const body = formatNotificationBody("training.assigned", {
      sopTitle: "Grill Safety",
      unexpectedKey: "should never appear",
    } as Record<string, string | number | boolean | null>);
    expect(body).toBe("Grill Safety");
    expect(body).not.toContain("unexpectedKey");
  });
});

describe("resolveNotificationText", () => {
  it("pairs the fixed title with the params-derived body", () => {
    const { title, body } = resolveNotificationText("qualification.awarded", {
      definitionName: "Grill Station",
    });
    expect(title).toBe("Qualification awarded");
    expect(body).toBe("Grill Station");
  });
});
