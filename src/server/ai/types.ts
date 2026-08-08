/**
 * Provider-neutral interfaces the job runner depends on. Production wiring (see `providers.ts`)
 * points these at real OpenAI/Anthropic HTTP calls guarded behind the configured API keys; every
 * automated test injects the deterministic fakes in `fakes.ts` instead, per
 * docs/testing-plan.md's "provider fakes" principle — the job runner itself never imports the real
 * clients directly, only through these interfaces, so a test can never accidentally reach a real
 * paid API.
 */
export interface TranscriptionResult {
  text: string;
  provider: string;
  model: string;
}

export interface TranscriptionProvider {
  transcribe(input: {
    buffer: Buffer;
    mimeType: string;
    fileName: string;
  }): Promise<TranscriptionResult>;
}

export interface DraftingResult {
  /** Unvalidated JSON the provider returned; the caller runs it through the versioned Zod schema. */
  raw: unknown;
  provider: string;
  model: string;
}

export interface DraftingProvider {
  draftSop(input: { transcript: string; sourceTitleHint: string }): Promise<DraftingResult>;
}

/**
 * Phase 20's second AI-assisted feature: drafting a single translated field/step for a manager to
 * review, upgrading Phase 13's manual-only translation entry. Reuses the same Anthropic credential
 * and provider-neutral shape as `DraftingProvider` above, but is a separate interface — one
 * bounded text-in/text-out call, not a multi-step transcription+drafting job.
 */
export interface TranslationDraftResult {
  /** Unvalidated JSON the provider returned; the caller runs it through the versioned Zod schema. */
  raw: unknown;
  provider: string;
  model: string;
}

export interface TranslationDraftingProvider {
  draftTranslation(input: {
    sourceText: string;
    targetLocale: string;
    contextLabel: string;
  }): Promise<TranslationDraftResult>;
}
