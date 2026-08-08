import { AiProviderError } from "@/server/ai/providers";
import type {
  DraftingProvider,
  DraftingResult,
  TranscriptionProvider,
  TranslationDraftingProvider,
  TranslationDraftResult,
} from "@/server/ai/types";

/**
 * Deterministic provider test doubles. Every automated test (unit, `db:verify`) that needs the
 * video-to-draft job runner to make progress injects these instead of the real HTTP clients in
 * `providers.ts` — per docs/testing-plan.md's "provider fakes" principle, no automated test may
 * ever reach the real OpenAI or Anthropic APIs, and these fakes cost nothing and never touch the
 * network.
 */

/** Always succeeds with a fixed, recognizable transcript. */
export const fakeTranscriptionProvider: TranscriptionProvider = {
  transcribe: async (input) => ({
    text: `[fake transcript for ${input.fileName}] Wash your hands. Preheat the grill to 400 degrees. Place the patty on the grill and cook for 4 minutes per side. Rest the burger for 2 minutes before serving. Warning: the grill surface stays hot after use.`,
    provider: "fake-openai",
    model: "fake-whisper-1",
  }),
};

/** Always fails with a transcription-shaped provider error, for testing retry/failure paths. */
export const alwaysFailingTranscriptionProvider: TranscriptionProvider = {
  transcribe: async () => {
    throw new AiProviderError("transcription_failed", "fake transcription failure");
  },
};

/** Returns a valid, schema-conformant structured draft derived from the transcript. */
export const fakeDraftingProvider: DraftingProvider = {
  draftSop: async (input): Promise<DraftingResult> => ({
    raw: {
      title: input.sourceTitleHint || "Grill line: burger cook",
      description: `Drafted from a transcript: ${input.transcript.slice(0, 120)}`,
      materials: [{ kind: "ingredient", name: "Burger patty", quantity: "1", unit: "each" }],
      warnings: [{ text: "The grill surface stays hot after use." }],
      steps: [
        {
          title: "Wash hands",
          instruction: "Wash your hands before handling food.",
          warning: "",
          quantity: "",
          unit: "",
          equipmentSetting: "",
          timerSeconds: null,
        },
        {
          title: "Cook the patty",
          instruction: "Place the patty on the grill and cook for 4 minutes per side.",
          warning: "",
          quantity: "",
          unit: "",
          equipmentSetting: "400F",
          timerSeconds: 240,
        },
      ],
    },
    provider: "fake-anthropic",
    model: "fake-claude",
  }),
};

/** Returns a payload that fails the versioned draft schema (missing required `instruction`). */
export const malformedDraftingProvider: DraftingProvider = {
  draftSop: async (): Promise<DraftingResult> => ({
    raw: { title: "Bad draft", steps: [{ title: "No instruction field" }] },
    provider: "fake-anthropic",
    model: "fake-claude",
  }),
};

/** Always fails with a drafting-shaped provider error, for testing retry/failure paths. */
export const alwaysFailingDraftingProvider: DraftingProvider = {
  draftSop: async () => {
    throw new AiProviderError("draft_generation_failed", "fake drafting failure");
  },
};

/**
 * Phase 20 AI-assisted translation drafting fakes — never the real Anthropic HTTP client, per the
 * same "provider fakes" principle the video-to-draft fakes above already follow.
 */

/** Always succeeds with a deterministic, recognizable, schema-valid translation. */
export const fakeTranslationDraftingProvider: TranslationDraftingProvider = {
  draftTranslation: async (input): Promise<TranslationDraftResult> => ({
    raw: { translatedText: `[${input.targetLocale}] ${input.sourceText}` },
    provider: "fake-anthropic",
    model: "fake-claude",
  }),
};

/** Returns a payload that fails the versioned translation draft schema (empty text). */
export const malformedTranslationDraftingProvider: TranslationDraftingProvider = {
  draftTranslation: async (): Promise<TranslationDraftResult> => ({
    raw: { translatedText: "" },
    provider: "fake-anthropic",
    model: "fake-claude",
  }),
};

/** Returns well-formed JSON that is nonetheless the wrong shape (missing `translatedText`). */
export const wrongShapeTranslationDraftingProvider: TranslationDraftingProvider = {
  draftTranslation: async (): Promise<TranslationDraftResult> => ({
    raw: { text: "no translatedText field here" },
    provider: "fake-anthropic",
    model: "fake-claude",
  }),
};

/** Always fails with a translation-drafting-shaped provider error, for testing failure paths. */
export const alwaysFailingTranslationDraftingProvider: TranslationDraftingProvider = {
  draftTranslation: async () => {
    throw new AiProviderError("translation_generation_failed", "fake translation failure");
  },
};
