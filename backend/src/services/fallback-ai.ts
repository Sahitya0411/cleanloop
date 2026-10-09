import type {
  AiOptions,
  ImageInput,
  Logger,
  SeverityAiResult,
  SortAiResult,
  WasteAi,
} from './types';

/** Tries each provider in turn (Bedrock first, Rekognition second). */
export class FallbackAi implements WasteAi {
  constructor(
    private providers: { name: string; ai: WasteAi }[],
    private log: Logger,
  ) {}

  private async first<T>(call: (ai: WasteAi) => Promise<T>, op: string): Promise<T> {
    let lastError: unknown;
    for (const { name, ai } of this.providers) {
      try {
        return await call(ai);
      } catch (err) {
        lastError = err;
        this.log.warn('ai provider failed', {
          provider: name,
          op,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    throw lastError instanceof Error ? lastError : new Error('No AI provider available');
  }

  classify(image: ImageInput, opts: AiOptions): Promise<SortAiResult> {
    return this.first((ai) => ai.classify(image, opts), 'classify');
  }

  assessSeverity(image: ImageInput, opts: AiOptions): Promise<SeverityAiResult> {
    return this.first((ai) => ai.assessSeverity(image, opts), 'assessSeverity');
  }
}
