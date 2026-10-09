import type Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import {
  SEVERITY_TOOL,
  SORT_TOOL,
  SeverityOutputSchema,
  SortOutputSchema,
  extractJsonObject,
  severitySystemPrompt,
  sortSystemPrompt,
} from '../core/ai-schema';
import type {
  AiOptions,
  ImageInput,
  Logger,
  SeverityAiResult,
  SortAiResult,
  WasteAi,
} from './types';

/** The slice of the Anthropic client this class uses; lets tests inject a fake. */
export interface MessagesClient {
  messages: {
    create(
      params: Anthropic.MessageCreateParamsNonStreaming,
      options?: { timeout?: number; maxRetries?: number },
    ): Promise<Anthropic.Message>;
  };
}

export interface AiBudget {
  /** Total time for all models, leaving the rest of the Lambda's 29 s for fallbacks. */
  totalMs: number;
  /** Cap for a single model call. */
  perCallMs: number;
}

export const DEFAULT_BUDGET: AiBudget = { totalMs: 18_000, perCallMs: 12_000 };
/** Not worth starting another model call with less time than this. */
const MIN_CALL_MS = 2_500;

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

/** Thinking counts toward max_tokens, so leave headroom beyond the short tool call. */
const MAX_TOKENS = 4000;

/**
 * Bedrock has two ways in: the Messages endpoint (bedrock-mantle; plain ids such as
 * `anthropic.claude-opus-5-5`) and the older bedrock-runtime InvokeModel API, which
 * takes inference-profile ids (`global.…`, `us.…`, `apac.…`) or versioned ids
 * (`…-v1`, `…-v1:0`). Some accounts can only use the older one.
 */
export function usesInvokeModel(model: string): boolean {
  return /^(global|us|eu|apac|jp|au|ca)\./.test(model) || /-v\d+(:\d+)?$/.test(model);
}

/** Effort is sent only on the Messages endpoint, and Haiku 4.5 rejects it there too. */
function supportsEffort(model: string): boolean {
  return !usesInvokeModel(model) && !model.includes('haiku-4-5');
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

export class AiOutputError extends Error {
  override name = 'AiOutputError';
}

/**
 * Claude in Amazon Bedrock. Tries each configured model in order, so an account
 * without access to the first model, or a refusal, falls through to the next one
 * instead of failing the request. `client` may pick a different client per model id.
 */
export class BedrockAi implements WasteAi {
  private clientFor: (model: string) => MessagesClient;

  constructor(
    client: MessagesClient | ((model: string) => MessagesClient),
    private models: string[],
    private log: Logger,
    private budget: AiBudget = DEFAULT_BUDGET,
  ) {
    if (!models.length) throw new Error('BedrockAi needs at least one model id');
    this.clientFor = typeof client === 'function' ? client : () => client;
  }

  async classify(image: ImageInput, opts: AiOptions): Promise<SortAiResult> {
    const out = await this.callTool(
      SORT_TOOL,
      sortSystemPrompt(opts.lang),
      image,
      'Which bin does the main item in this photo go in?',
      SortOutputSchema,
    );
    return { ...out, source: 'bedrock' };
  }

  async assessSeverity(image: ImageInput, opts: AiOptions): Promise<SeverityAiResult> {
    const out = await this.callTool(
      SEVERITY_TOOL,
      severitySystemPrompt(opts.lang),
      image,
      'Triage this photo reported by a resident.',
      SeverityOutputSchema,
    );
    return { ...out, source: 'bedrock' };
  }

  private async callTool<T>(
    tool: Anthropic.Tool,
    system: string,
    image: ImageInput,
    prompt: string,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const mediaType: ImageType = (IMAGE_TYPES as readonly string[]).includes(image.mediaType)
      ? (image.mediaType as ImageType)
      : 'image/jpeg';
    const data = Buffer.from(image.bytes).toString('base64');

    const deadline = Date.now() + this.budget.totalMs;
    let lastError: unknown;
    for (const model of this.models) {
      const remaining = deadline - Date.now();
      if (remaining < MIN_CALL_MS) {
        this.log.warn('bedrock time budget used up', { model, tool: tool.name });
        break;
      }
      try {
        const message = await this.clientFor(model).messages.create(
          {
            model,
            max_tokens: MAX_TOKENS,
            system,
            tools: [tool],
            tool_choice: { type: 'auto' },
            ...(supportsEffort(model) ? { output_config: { effort: 'low' as const } } : {}),
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
                  { type: 'text', text: prompt },
                ],
              },
            ],
          },
          { timeout: Math.min(this.budget.perCallMs, remaining), maxRetries: 0 },
        );
        if (message.stop_reason === 'refusal') {
          throw new AiOutputError(`Model ${model} declined the request`);
        }
        const toolUse = message.content.find(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === tool.name,
        );
        const raw = toolUse ? toolUse.input : extractJsonObject(textOf(message));
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          throw new AiOutputError(`Model ${model} returned an invalid ${tool.name} payload`);
        }
        return parsed.data;
      } catch (err) {
        lastError = err;
        this.log.warn('bedrock model failed, trying next', {
          model,
          tool: tool.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    throw lastError instanceof Error ? lastError : new AiOutputError('All Bedrock models failed');
  }
}
