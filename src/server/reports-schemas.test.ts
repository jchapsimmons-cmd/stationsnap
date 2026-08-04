import { describe, expect, it } from "vitest";
import { activityQuerySchema } from "@/server/events-schemas";
import { approvalHistoryReportQuerySchema } from "@/server/reports-schemas";
import { qualificationsReportQuerySchema } from "@/server/training/paths-schemas";
import { checklistCompletionReportQuerySchema } from "@/server/checklists/schemas";
import { sopVersionHistoryReportQuerySchema } from "@/server/sops/schemas";
import { trainingProgressReportQuerySchema } from "@/server/training/schemas";

describe("Phase 14 report query schemas", () => {
  it("activityQuerySchema defaults page to 1 and pageSize to 20", () => {
    const result = activityQuerySchema.parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.locationId).toBe("");
    expect(result.type).toBe("");
  });

  it("activityQuerySchema rejects an unknown event type", () => {
    expect(() => activityQuerySchema.parse({ type: "not.a.real.type" })).toThrow();
  });

  it("activityQuerySchema coerces page/pageSize from query-string strings", () => {
    const result = activityQuerySchema.parse({ page: "3", pageSize: "50" });
    expect(result.page).toBe(3);
    expect(result.pageSize).toBe(50);
  });

  it("activityQuerySchema rejects a pageSize above the bound", () => {
    expect(() => activityQuerySchema.parse({ pageSize: "500" })).toThrow();
  });

  it("activityQuerySchema rejects a page below 1", () => {
    expect(() => activityQuerySchema.parse({ page: "0" })).toThrow();
  });

  it("trainingProgressReportQuerySchema defaults every filter to unset", () => {
    const result = trainingProgressReportQuerySchema.parse({});
    expect(result.status).toBe("");
    expect(result.locationId).toBe("");
    expect(result.search).toBe("");
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  it("trainingProgressReportQuerySchema rejects an unknown status", () => {
    expect(() => trainingProgressReportQuerySchema.parse({ status: "not_a_status" })).toThrow();
  });

  it("qualificationsReportQuerySchema accepts a tab and pagination together", () => {
    const result = qualificationsReportQuerySchema.parse({ tab: "expiring", page: "2" });
    expect(result.tab).toBe("expiring");
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(20);
  });

  it("checklistCompletionReportQuerySchema trims and bounds the search term", () => {
    const result = checklistCompletionReportQuerySchema.parse({ search: "  closing crew  " });
    expect(result.search).toBe("closing crew");
  });

  it("sopVersionHistoryReportQuerySchema defaults category and status to unset", () => {
    const result = sopVersionHistoryReportQuerySchema.parse({});
    expect(result.category).toBe("");
    expect(result.status).toBe("");
  });

  it("approvalHistoryReportQuerySchema only accepts the three decision values", () => {
    expect(approvalHistoryReportQuerySchema.parse({ decision: "approved" }).decision).toBe(
      "approved",
    );
    expect(() => approvalHistoryReportQuerySchema.parse({ decision: "pending" })).toThrow();
  });
});
