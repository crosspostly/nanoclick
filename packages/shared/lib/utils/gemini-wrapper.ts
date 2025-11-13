/* eslint-disable @typescript-eslint/no-explicit-any */
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Content, Part } from '@google/generative-ai';

interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

interface GeminiConfig {
  apiKey: string;
  model?: string;
  retryConfig?: Partial<RetryConfig>;
}

interface FunctionCallResult {
  name: string;
  args: Record<string, any>;
}

/**
 * Safe wrapper for Gemini API with retry logic and fallbacks
 *
 * This wrapper fixes the common error:
 * "Invalid JSON payload received. Unknown name 'args' at 'contents[N].parts[M].function_call': Proto field is not repeating, cannot start list"
 *
 * Key features:
 * - Validates and sanitizes conversation history
 * - Retries on failure with exponential backoff
 * - Converts arrays to objects for function_call.args and functionResponse.response
 * - Automatically fixes snake_case to camelCase naming
 * - Truncates history as fallback strategy
 */
export class GeminiWrapper {
  private genAI: GoogleGenerativeAI;
  private modelName: string;
  private retryConfig: RetryConfig;

  constructor(config: GeminiConfig) {
    this.genAI = new GoogleGenerativeAI(config.apiKey);
    this.modelName = config.model || 'gemini-2.5-flash-lite';
    this.retryConfig = {
      maxRetries: 3,
      initialDelay: 1000,
      maxDelay: 10000,
      backoffMultiplier: 2,
      ...config.retryConfig,
    };
  }

  /**
   * CRITICAL: Properly format function call for history
   * Always use camelCase (functionCall) and ensure args is an object
   */
  private formatFunctionCall(functionCall: FunctionCallResult): Part {
    return {
      functionCall: {
        name: functionCall.name,
        args: functionCall.args || {},
      },
    };
  }

  /**
   * CRITICAL: Properly format function response for history
   * Always wrap response in an object (never array)
   */
  private formatFunctionResponse(name: string, response: any): Part {
    const safeResponse =
      response && typeof response === 'object' && !Array.isArray(response) ? response : { value: response };

    return {
      functionResponse: {
        name,
        response: safeResponse,
      },
    };
  }

  /**
   * Validate conversation history before sending to API
   */
  private validateContents(contents: Content[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    contents.forEach((content, index) => {
      if (!content.role || !['user', 'model'].includes(content.role)) {
        errors.push(`contents[${index}]: Invalid role "${content.role}"`);
      }

      if (!content.parts || !Array.isArray(content.parts)) {
        errors.push(`contents[${index}]: parts must be an array`);
        return;
      }

      content.parts.forEach((part: any, partIndex: number) => {
        // Check functionCall
        if ('functionCall' in part) {
          const fc = (part as any).functionCall;
          if (!fc.name) {
            errors.push(`contents[${index}].parts[${partIndex}]: functionCall missing name`);
          }
          if (fc.args && Array.isArray(fc.args)) {
            errors.push(`contents[${index}].parts[${partIndex}]: functionCall.args must be object, not array`);
          }
        }

        // Check functionResponse
        if ('functionResponse' in part) {
          const fr = (part as any).functionResponse;
          if (!fr.name) {
            errors.push(`contents[${index}].parts[${partIndex}]: functionResponse missing name`);
          }
          if (fr.response && Array.isArray(fr.response)) {
            errors.push(`contents[${index}].parts[${partIndex}]: functionResponse.response must be object, not array`);
          }
        }

        // Check for snake_case (common mistake)
        if ('function_call' in part) {
          errors.push(`contents[${index}].parts[${partIndex}]: Use functionCall (camelCase), not function_call`);
        }
        if ('function_response' in part) {
          errors.push(
            `contents[${index}].parts[${partIndex}]: Use functionResponse (camelCase), not function_response`,
          );
        }
      });
    });

    return { valid: errors.length === 0, errors };
  }

  /**
   * Sanitize contents array to fix common issues
   */
  private sanitizeContents(contents: Content[]): Content[] {
    return contents.map(content => ({
      role: content.role,
      parts: content.parts.map((part: any) => {
        // Fix functionCall
        if ('functionCall' in part) {
          const fc = (part as any).functionCall;
          return {
            functionCall: {
              name: fc.name,
              args: Array.isArray(fc.args) ? {} : fc.args || {},
            },
          };
        }

        // Fix functionResponse
        if ('functionResponse' in part) {
          const fr = (part as any).functionResponse;
          let response = fr.response;

          if (Array.isArray(response)) {
            response = { items: response };
          } else if (!response || typeof response !== 'object') {
            response = { value: response };
          }

          return {
            functionResponse: {
              name: fr.name,
              response,
            },
          };
        }

        // Fix snake_case to camelCase
        if ('function_call' in part) {
          const fc = (part as any).function_call;
          return {
            functionCall: {
              name: fc.name,
              args: Array.isArray(fc.args) ? {} : fc.args || {},
            },
          };
        }

        if ('function_response' in part) {
          const fr = (part as any).function_response;
          let response = fr.response;
          if (Array.isArray(response)) {
            response = { items: response };
          } else if (!response || typeof response !== 'object') {
            response = { value: response };
          }

          return {
            functionResponse: {
              name: fr.name,
              response,
            },
          };
        }

        return part;
      }),
    }));
  }

  /**
   * Delay with exponential backoff
   */
  private async delay(attempt: number): Promise<void> {
    const delay = Math.min(
      this.retryConfig.initialDelay * Math.pow(this.retryConfig.backoffMultiplier, attempt),
      this.retryConfig.maxDelay,
    );
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: any): boolean {
    // 400 - might be fixable with data sanitization
    if (error.status === 400) {
      return error.message?.includes('Invalid JSON payload') || error.message?.includes('Proto field');
    }

    // 429 - rate limit, 500+ - server errors
    return error.status === 429 || error.status >= 500;
  }

  /**
   * Generate content with retry and fallback
   */
  async generateContentWithRetry(
    contents: Content[],
    options?: {
      generationConfig?: any;
      safetySettings?: any;
      tools?: any[];
    },
  ): Promise<any> {
    let lastError: Error | null = null;
    let sanitizedContents = contents;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          console.warn(`[Gemini] Retry attempt ${attempt}/${this.retryConfig.maxRetries}`);
          sanitizedContents = this.sanitizeContents(sanitizedContents);
        }

        const validation = this.validateContents(sanitizedContents);
        if (!validation.valid) {
          console.error('[Gemini] Validation errors:', validation.errors);
          sanitizedContents = this.sanitizeContents(sanitizedContents);

          const revalidation = this.validateContents(sanitizedContents);
          if (!revalidation.valid) {
            console.error('[Gemini] Auto-fix failed:', revalidation.errors);
            throw new Error(`Invalid contents structure: ${revalidation.errors.join(', ')}`);
          }
        }

        const model = this.genAI.getGenerativeModel({
          model: this.modelName,
          generationConfig: options?.generationConfig,
          safetySettings: options?.safetySettings,
          tools: options?.tools,
        });

        const result = await model.generateContent({
          contents: sanitizedContents,
        });

        return result;
      } catch (error: any) {
        lastError = error;

        console.error(`[Gemini] Attempt ${attempt + 1} failed:`, {
          message: error.message,
          status: error.status,
          statusText: error.statusText,
        });

        const isRetryable = this.isRetryableError(error);

        if (!isRetryable || attempt === this.retryConfig.maxRetries) {
          break;
        }

        await this.delay(attempt);
      }
    }

    // Fallback: try with truncated history
    console.warn('[Gemini] All retries failed, trying with truncated history');
    return this.fallbackWithTruncatedHistory(sanitizedContents, options, lastError);
  }

  /**
   * Fallback: truncate history and retry
   */
  private async fallbackWithTruncatedHistory(
    contents: Content[],
    options?: any,
    originalError?: Error | null,
  ): Promise<any> {
    try {
      const truncatedContents = contents.slice(-6);

      console.warn(`[Gemini] Truncating history from ${contents.length} to ${truncatedContents.length} messages`);

      const model = this.genAI.getGenerativeModel({
        model: this.modelName,
        generationConfig: options?.generationConfig,
        safetySettings: options?.safetySettings,
        tools: options?.tools,
      });

      return await model.generateContent({
        contents: truncatedContents,
      });
    } catch (fallbackError) {
      console.error('[Gemini] Fallback also failed:', fallbackError);
      throw originalError || fallbackError;
    }
  }

  /**
   * Add function call to history
   */
  addFunctionCallToHistory(contents: Content[], functionCall: FunctionCallResult): Content[] {
    return [
      ...contents,
      {
        role: 'model',
        parts: [this.formatFunctionCall(functionCall)],
      },
    ];
  }

  /**
   * Add function response to history
   */
  addFunctionResponseToHistory(contents: Content[], name: string, response: any): Content[] {
    return [
      ...contents,
      {
        role: 'user',
        parts: [this.formatFunctionResponse(name, response)],
      },
    ];
  }

  /**
   * Convenient method for function calling loop
   */
  async chat(
    initialMessage: string,
    tools: any[],
    onFunctionCall: (functionCall: FunctionCallResult) => Promise<any>,
    maxTurns = 10,
  ) {
    let contents: Content[] = [
      {
        role: 'user',
        parts: [{ text: initialMessage }],
      },
    ];

    for (let turn = 0; turn < maxTurns; turn++) {
      const result = await this.generateContentWithRetry(contents, { tools });

      const response = result.response;
      const functionCalls = response.functionCalls();

      if (!functionCalls || functionCalls.length === 0) {
        return {
          finalResponse: response.text(),
          contents,
          turns: turn + 1,
        };
      }

      for (const fc of functionCalls) {
        console.log(`[Gemini] Function call: ${fc.name}`, fc.args);

        contents = this.addFunctionCallToHistory(contents, {
          name: fc.name,
          args: fc.args,
        });

        const functionResult = await onFunctionCall({
          name: fc.name,
          args: fc.args,
        });

        contents = this.addFunctionResponseToHistory(contents, fc.name, functionResult);
      }
    }

    throw new Error(`Max turns (${maxTurns}) exceeded`);
  }
}
