import { describe, expect, it } from "vitest";
import {
  employeeSopLocaleQuerySchema,
  translationMatrixQuerySchema,
  translationUpsertSchema,
} from "@/server/sops/schemas";

const entityId = crypto.randomUUID();

describe("Phase 13 translation schemas", () => {
  it("accepts a valid sop_version field with an allowed field name", () => {
    const result = translationUpsertSchema.parse({
      entityType: "sop_version",
      entityId,
      field: "title",
      targetLocale: "es",
      translatedText: "Saneamiento de la parrilla",
    });
    expect(result.field).toBe("title");
  });

  it("rejects a field name that does not belong to the entity type", () => {
    expect(() =>
      translationUpsertSchema.parse({
        entityType: "sop_material",
        entityId,
        field: "instruction",
        targetLocale: "es",
        translatedText: "Pollo",
      }),
    ).toThrow();
  });

  it("only accepts sop_material with the name field", () => {
    const result = translationUpsertSchema.parse({
      entityType: "sop_material",
      entityId,
      field: "name",
      targetLocale: "es",
      translatedText: "Pechuga de pollo",
    });
    expect(result.entityType).toBe("sop_material");
  });

  it("only accepts sop_warning with the text field", () => {
    const result = translationUpsertSchema.parse({
      entityType: "sop_warning",
      entityId,
      field: "text",
      targetLocale: "es",
      translatedText: "Superficie caliente",
    });
    expect(result.entityType).toBe("sop_warning");
  });

  it("accepts step title, instruction, and warning fields", () => {
    for (const field of ["title", "instruction", "warning"] as const) {
      expect(() =>
        translationUpsertSchema.parse({
          entityType: "sop_step",
          entityId,
          field,
          targetLocale: "es",
          translatedText: "Texto traducido",
        }),
      ).not.toThrow();
    }
  });

  it("rejects an unsupported target locale", () => {
    expect(() =>
      translationUpsertSchema.parse({
        entityType: "sop_version",
        entityId,
        field: "title",
        targetLocale: "fr",
        translatedText: "Titre",
      }),
    ).toThrow();
  });

  it("rejects an invalid entity id", () => {
    expect(() =>
      translationUpsertSchema.parse({
        entityType: "sop_version",
        entityId: "not-a-uuid",
        field: "title",
        targetLocale: "es",
        translatedText: "Titulo",
      }),
    ).toThrow();
  });

  it("trims translated text and bounds its length", () => {
    const result = translationUpsertSchema.parse({
      entityType: "sop_warning",
      entityId,
      field: "text",
      targetLocale: "es",
      translatedText: "  Cuidado  ",
    });
    expect(result.translatedText).toBe("Cuidado");
    expect(() =>
      translationUpsertSchema.parse({
        entityType: "sop_warning",
        entityId,
        field: "text",
        targetLocale: "es",
        translatedText: "x".repeat(501),
      }),
    ).toThrow();
  });

  it("allows empty translated text so a manager can clear a draft", () => {
    expect(() =>
      translationUpsertSchema.parse({
        entityType: "sop_version",
        entityId,
        field: "title",
        targetLocale: "es",
        translatedText: "",
      }),
    ).not.toThrow();
  });

  it("defaults the translation matrix query to Spanish", () => {
    expect(translationMatrixQuerySchema.parse({}).targetLocale).toBe("es");
  });

  it("rejects an unsupported matrix target locale", () => {
    expect(() => translationMatrixQuerySchema.parse({ targetLocale: "fr" })).toThrow();
  });

  it("defaults the employee locale query to English", () => {
    expect(employeeSopLocaleQuerySchema.parse({}).lang).toBe("en");
  });

  it("accepts English or Spanish as the employee locale", () => {
    expect(employeeSopLocaleQuerySchema.parse({ lang: "en" }).lang).toBe("en");
    expect(employeeSopLocaleQuerySchema.parse({ lang: "es" }).lang).toBe("es");
  });

  it("rejects an unsupported employee locale", () => {
    expect(() => employeeSopLocaleQuerySchema.parse({ lang: "fr" })).toThrow();
  });
});
