import { getServerEnv } from "@/lib/env";
import type {
  DraftingProvider,
  DraftingResult,
  TranscriptionProvider,
  TranscriptionResult,
} from "@/server/ai/types";

/** Thrown by the real providers below when their API key is missing or the provider call itself
 * fails; the job runner catches this and records a safe, non-secret error code — never this
 * message's own text, which is developer-facing only. */
export class AiProviderError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AiProviderError";
    this.code = code;
  }
}

const WHISPER_MODEL = "whisper-1";
const CLAUDE_MODEL = "claude-sonnet-4-5-20250929";

/**
 * Real OpenAI Whisper transcription over OpenAI's REST API directly (no SDK dependency — the
 * request shape is a single multipart POST, not worth a new package). Guarded behind
 * `OPENAI_API_KEY`; never constructed or called by any automated test.
 */
export const whisperTranscriptionProvider: TranscriptionProvider = {
  async transcribe(input): Promise<TranscriptionResult> {
    const env = getServerEnv();
    if (!env.OPENAI_API_KEY) {
      throw new AiProviderError("provider_not_configured", "OPENAI_API_KEY is not configured.");
    }
    const form = new FormData();
    form.set("model", WHISPER_MODEL);
    form.set(
      "file",
      new Blob([new Uint8Array(input.buffer)], { type: input.mimeType }),
      input.fileName,
    );
    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
        body: form,
      });
    } catch {
      throw new AiProviderError("transcription_unreachable", "The transcription request failed.");
    }
    if (!response.ok) {
      throw new AiProviderError(
        "transcription_failed",
        `The transcription provider returned status ${response.status}.`,
      );
    }
    const data = (await response.json().catch(() => null)) as { text?: unknown } | null;
    if (!data || typeof data.text !== "string" || data.text.trim().length === 0) {
      throw new AiProviderError(
        "transcription_invalid_response",
        "The transcription provider returned an unusable response.",
      );
    }
    return { text: data.text, provider: "openai", model: WHISPER_MODEL };
  },
};

const DRAFT_PROMPT_INSTRUCTIONS = `You turn a restaurant training video transcript into a structured standard operating
procedure draft. Respond with a single JSON object only — no prose, no markdown fences — matching
exactly this shape:
{
  "title": string,
  "description": string,
  "materials": [{ "kind": "material" | "ingredient", "name": string, "quantity": string, "unit": string }],
  "warnings": [{ "text": string }],
  "steps": [{ "title": string, "instruction": string, "warning": string, "quantity": string, "unit": string, "equipmentSetting": string, "timerSeconds": number | null }]
}
Every step needs a clear, actionable "instruction". Omit a field entirely rather than guessing when
the transcript does not support it (empty string or empty array is fine; do not invent quantities,
units, or timer durations the transcript never mentions).`;

/**
 * Real Anthropic Claude drafting over the Messages API directly (no SDK dependency, same rationale
 * as the Whisper client above). Guarded behind `ANTHROPIC_API_KEY`; never constructed or called by
 * any automated test. Returns the raw parsed JSON — validation against the versioned schema in
 * `draft-schema.ts` happens one layer up in the job runner, the same "provider client stays dumb,
 * schema validation is centralized" shape `translations.ts` already uses for manual input.
 */
export const claudeDraftingProvider: DraftingProvider = {
  async draftSop(input): Promise<DraftingResult> {
    const env = getServerEnv();
    if (!env.ANTHROPIC_API_KEY) {
      throw new AiProviderError("provider_not_configured", "ANTHROPIC_API_KEY is not configured.");
    }
    let response: Response;
    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: 4_096,
          system: DRAFT_PROMPT_INSTRUCTIONS,
          messages: [
            {
              role: "user",
              content: `Video title hint: ${input.sourceTitleHint || "(none given)"}\n\nTranscript:\n${input.transcript}`,
            },
          ],
        }),
      });
    } catch {
      throw new AiProviderError("draft_unreachable", "The drafting request failed.");
    }
    if (!response.ok) {
      throw new AiProviderError(
        "draft_generation_failed",
        `The drafting provider returned status ${response.status}.`,
      );
    }
    const data = (await response.json().catch(() => null)) as {
      content?: { type?: string; text?: string }[];
    } | null;
    const text = data?.content?.find((block) => block.type === "text")?.text;
    if (typeof text !== "string") {
      throw new AiProviderError(
        "draft_invalid_response",
        "The drafting provider returned an unusable response.",
      );
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new AiProviderError(
        "draft_invalid_json",
        "The drafting provider's response was not valid JSON.",
      );
    }
    return { raw, provider: "anthropic", model: CLAUDE_MODEL };
  },
};
