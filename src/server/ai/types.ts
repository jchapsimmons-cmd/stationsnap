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
