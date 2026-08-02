import { describe, expect, it } from "vitest";
import { employeeSeed, managerSeed, seedIds } from "@/server/db/seed-data";

describe("demo seed data", () => {
  it("contains the required Phase 1 records", () => {
    expect(Object.keys(seedIds.locations)).toHaveLength(2);
    expect(Object.keys(seedIds.stations)).toHaveLength(4);
    expect(managerSeed).toHaveLength(3);
    expect(employeeSeed).toHaveLength(5);
  });

  it("uses unique employee numbers", () => {
    const numbers = employeeSeed.map((employee) => employee.employeeNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});
