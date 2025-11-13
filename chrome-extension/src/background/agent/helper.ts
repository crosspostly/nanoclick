import { type ProviderConfig, type ModelConfig, ProviderTypeEnum } from '@extension/storage';
import { ChatOpenAI, AzureChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatXAI } from '@langchain/xai';
import { ChatGroq } from '@langchain/groq';
import { ChatCerebras } from '@langchain/cerebras';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOllama } from '@langchain/ollama';
import { ChatDeepSeek } from '@langchain/deepseek';
import { AIMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { GeminiWrapper } from '@extension/shared';

const maxTokens = 1024 * 4;

// Rate limiter for Gemini API to respect 30 requests/minute limit
class GeminiRateLimiter {
  private lastRequest = 0;
  private readonly minInterval = 2000; // 30 requests per minute = 2s between requests

  async execute<T>(request: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequest;

    if (timeSinceLastRequest < this.minInterval) {
      const waitTime = this.minInterval - timeSinceLastRequest;
      console.log(`[GeminiRateLimiter] Waiting ${waitTime}ms to respect rate limit`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastRequest = Date.now();
    return request();
  }
}

const geminiRateLimiter = new GeminiRateLimiter();

// Custom ChatLlama class to handle Llama API response format
class ChatLlama extends ChatOpenAI {
  constructor(args: any) {
    super(args);
  }

  // Override the completionWithRetry method to intercept and transform the response
  async completionWithRetry(request: any, options?: any): Promise<any> {
    try {
      // Make the request using the parent's implementation
      const response = await super.completionWithRetry(request, options);

      // Check if this is a Llama API response format
      if (response?.completion_message?.content?.text) {
        // Transform Llama API response to OpenAI format
        const transformedResponse = {
          id: response.id || 'llama-response',
          object: 'chat.completion',
          created: Date.now(),
          model: request.model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: response.completion_message.content.text,
              },
              finish_reason: response.completion_message.stop_reason || 'stop',
            },
          ],
          usage: {
            prompt_tokens: response.metrics?.find((m: any) => m.metric === 'num_prompt_tokens')?.value || 0,
            completion_tokens: response.metrics?.find((m: any) => m.metric === 'num_completion_tokens')?.value || 0,
            total_tokens: response.metrics?.find((m: any) => m.metric === 'num_total_tokens')?.value || 0,
          },
        };

        return transformedResponse;
      }

      return response;
    } catch (error: any) {
      console.error(`[ChatLlama] Error during API call:`, error);
      throw error;
    }
  }
}

// O series models or GPT-5 models that support reasoning
function isOpenAIReasoningModel(modelName: string): boolean {
  let modelNameWithoutProvider = modelName;
  if (modelName.startsWith('openai/')) {
    modelNameWithoutProvider = modelName.substring(7);
  }
  return (
    modelNameWithoutProvider.startsWith('o') ||
    (modelNameWithoutProvider.startsWith('gpt-5') && !modelNameWithoutProvider.startsWith('gpt-5-chat'))
  );
}

// Function to check if a model is an Anthropic Opus model
function isAnthropicOpusModel(modelName: string): boolean {
  // Extract the model name without provider prefix if present
  let modelNameWithoutProvider = modelName;
  if (modelName.startsWith('anthropic/')) {
    modelNameWithoutProvider = modelName.substring(10);
  }
  return modelNameWithoutProvider.startsWith('claude-opus');
}

function createOpenAIChatModel(
  providerConfig: ProviderConfig,
  modelConfig: ModelConfig,
  // Add optional extra fetch options for headers etc.
  extraFetchOptions: { headers?: Record<string, string> } | undefined,
): BaseChatModel {
  const args: {
    model: string;
    apiKey?: string;
    // Configuration should align with ClientOptions from @langchain/openai
    configuration?: Record<string, unknown>;
    modelKwargs?: {
      max_completion_tokens: number;
      reasoning_effort?: 'minimal' | 'low' | 'medium' | 'high';
    };
    topP?: number;
    temperature?: number;
    maxTokens?: number;
  } = {
    model: modelConfig.modelName,
    apiKey: providerConfig.apiKey,
  };

  const configuration: Record<string, unknown> = {};
  if (providerConfig.baseUrl) {
    configuration.baseURL = providerConfig.baseUrl;
  }
  if (extraFetchOptions?.headers) {
    configuration.defaultHeaders = extraFetchOptions.headers;
  }
  args.configuration = configuration;

  // custom provider may have no api key
  if (providerConfig.apiKey) {
    args.apiKey = providerConfig.apiKey;
  }

  // O series models have different parameters
  if (isOpenAIReasoningModel(modelConfig.modelName)) {
    args.modelKwargs = {
      max_completion_tokens: maxTokens,
    };

    // Add reasoning_effort parameter for o-series models if specified
    if (modelConfig.reasoningEffort) {
      args.modelKwargs.reasoning_effort = modelConfig.reasoningEffort;
    }
  } else {
    args.topP = (modelConfig.parameters?.topP ?? 0.1) as number;
    args.temperature = (modelConfig.parameters?.temperature ?? 0.1) as number;
    args.maxTokens = maxTokens;
  }
  return new ChatOpenAI(args);
}

// Function to extract instance name from Azure endpoint URL
function extractInstanceNameFromUrl(url: string): string | null {
  try {
    const parsedUrl = new URL(url);
    const hostnameParts = parsedUrl.hostname.split('.');
    // Expecting format like instance-name.openai.azure.com
    if (hostnameParts.length >= 4 && hostnameParts[1] === 'openai' && hostnameParts[2] === 'azure') {
      return hostnameParts[0];
    }
  } catch (e) {
    console.error('Error parsing Azure endpoint URL:', e);
  }
  return null;
}

// Function to check if a provider ID is an Azure provider
function isAzureProvider(providerId: string): boolean {
  return providerId === ProviderTypeEnum.AzureOpenAI || providerId.startsWith(`${ProviderTypeEnum.AzureOpenAI}_`);
}

// Function to create an Azure OpenAI chat model
function createAzureChatModel(providerConfig: ProviderConfig, modelConfig: ModelConfig): BaseChatModel {
  const temperature = (modelConfig.parameters?.temperature ?? 0.1) as number;
  const topP = (modelConfig.parameters?.topP ?? 0.1) as number;

  // Validate necessary fields first
  if (
    !providerConfig.baseUrl ||
    !providerConfig.azureDeploymentNames ||
    providerConfig.azureDeploymentNames.length === 0 ||
    !providerConfig.azureApiVersion ||
    !providerConfig.apiKey
  ) {
    throw new Error(
      'Azure configuration is incomplete. Endpoint, Deployment Name, API Version, and API Key are required. Please check settings.',
    );
  }

  // Instead of always using the first deployment name, use the model name from modelConfig
  // which contains the actual model selected in the UI
  const deploymentName = modelConfig.modelName;

  // Validate that the selected model exists in the configured deployments
  if (!providerConfig.azureDeploymentNames.includes(deploymentName)) {
    console.warn(
      `[createChatModel] Selected deployment "${deploymentName}" not found in available deployments. ` +
        `Available: ${JSON.stringify(providerConfig.azureDeploymentNames)}. Using the model anyway.`,
    );
  }

  // Extract instance name from the endpoint URL
  const instanceName = extractInstanceNameFromUrl(providerConfig.baseUrl);
  if (!instanceName) {
    throw new Error(
      `Could not extract Instance Name from Azure Endpoint URL: ${providerConfig.baseUrl}. Expected format like https://<your-instance-name>.openai.azure.com/`,
    );
  }

  // Check if the Azure deployment is using an "o" series model (GPT-4o, etc.)
  const isOSeriesModel = isOpenAIReasoningModel(deploymentName);

  // Use AzureChatOpenAI with specific parameters
  const args = {
    azureOpenAIApiInstanceName: instanceName, // Derived from endpoint
    azureOpenAIApiDeploymentName: deploymentName,
    azureOpenAIApiKey: providerConfig.apiKey,
    azureOpenAIApiVersion: providerConfig.azureApiVersion,
    // For Azure, the model name should be the deployment name itself
    model: deploymentName, // Set model = deployment name to fix Azure requests
    // For O series models, use modelKwargs instead of temperature/topP
    ...(isOSeriesModel
      ? {
          modelKwargs: {
            max_completion_tokens: maxTokens,
            // Add reasoning_effort parameter for Azure o-series models if specified
            ...(modelConfig.reasoningEffort ? { reasoning_effort: modelConfig.reasoningEffort } : {}),
          },
        }
      : {
          temperature,
          topP,
          maxTokens,
        }),
    // DO NOT pass baseUrl or configuration here
  };
  // console.log('[createChatModel] Azure args passed to AzureChatOpenAI:', args);
  return new AzureChatOpenAI(args);
}

// Wrapper class for GeminiWrapper to make it compatible with LangChain BaseChatModel
// 
// This class extends ChatGoogleGenerativeAI but overrides the key methods to use
// GeminiWrapper instead of the parent class implementation. This ensures that:
// - Retry logic from GeminiWrapper is applied
// - Conversation history validation happens
// - Function call fixes (snake_case → camelCase) are applied
// - Rate limiting is honored between requests
// - All wrapper features are properly utilized
class GeminiChatModel extends ChatGoogleGenerativeAI {
  private geminiWrapper: GeminiWrapper;
  private rateLimiter: GeminiRateLimiter;
  private fallbackMode = false;
  private responseCache: Map<string, any> = new Map();

  constructor(args: any) {
    // Initialize wrapper and rate limiter first
    const geminiWrapper = new GeminiWrapper({
      apiKey: args.apiKey,
      model: args.model,
      retryConfig: {
        maxRetries: 3,
        initialDelay: 2000, // 2s for rate limiting
        maxDelay: 30000, // 30s max
        backoffMultiplier: 2,
      },
    });

    // Now call super with minimal config since we'll override the main methods
    super(args);

    this.geminiWrapper = geminiWrapper;
    this.rateLimiter = new GeminiRateLimiter();
  }

  // Override the main invoke method to use GeminiWrapper
  async invoke(messages: BaseMessage[], options?: any): Promise<any> {
    console.log('[GeminiChatModel] Using GeminiWrapper instead of ChatGoogleGenerativeAI');
    
    // Use rate limiter to respect 30 requests/minute limit
    return this.rateLimiter.execute(async () => {
      try {
        console.log('[GeminiChatModel] Converting messages to Gemini format');
        // Convert LangChain BaseMessage[] to Gemini Content[] format
        const conversationHistory = this._convertMessagesToGeminiFormat(messages);
        
        // Extract tools from options if present
        const tools = options?.tools;
        
        console.log('[GeminiChatModel] Calling GeminiWrapper.generateContentWithRetry');
        // Use GeminiWrapper with retry logic
        const result = await this.geminiWrapper.generateContentWithRetry(
          conversationHistory,
          {
            generationConfig: options?.generationConfig,
            safetySettings: options?.safetySettings,
            tools,
          },
        );

        console.log('[GeminiChatModel] GeminiWrapper call successful, converting response');
        // Convert Gemini response back to LangChain format
        const response = this._convertGeminiResponseToLangChainMessage(result);
        
        // Cache successful responses for fallback
        const queryHash = this.hashMessages(messages);
        this.responseCache.set(queryHash, {
          response,
          timestamp: Date.now(),
        });
        
        return response;
      } catch (error: any) {
        console.error('[GeminiChatModel] Error in invoke:', error);
        
        // Check if it's a rate limit error
        if (error.message?.includes('429') || error.message?.includes('quota') || error.status === 429) {
          console.warn('[Gemini] Rate limited, entering fallback mode');
          this.fallbackMode = true;
          
          // Fallback strategies:
          // 1. Use cached responses for similar queries
          const cachedResponse = await this.getCachedResponse(messages);
          if (cachedResponse) {
            console.info('[Gemini] Using cached response');
            return cachedResponse;
          }
          
          // 2. Use simplified response (no function calls)
          console.info('[Gemini] Using simplified response mode');
          return this.generateSimplifiedResponse(messages);
        }
        
        throw error;
      }
    });
  }

  /**
   * Get cached response for similar queries
   */
  private async getCachedResponse(messages: BaseMessage[]): Promise<any> {
    const queryHash = this.hashMessages(messages);
    const cached = this.responseCache.get(queryHash);
    
    if (cached && this.isFreshCache(cached)) {
      return cached.response;
    }
    
    return null;
  }

  /**
   * Hash messages for caching
   */
  private hashMessages(messages: BaseMessage[]): string {
    const content = messages.map(m => m.content).join('|');
    return btoa(content).slice(0, 16);
  }

  /**
   * Check if cache is fresh (within 5 minutes)
   */
  private isFreshCache(cached: any): boolean {
    return Date.now() - cached.timestamp < 5 * 60 * 1000;
  }

  /**
   * Generate simplified response when in degraded mode
   */
  private generateSimplifiedResponse(messages: BaseMessage[]): any {
    const lastMessage = messages[messages.length - 1];
    const text = `I'm operating in degraded mode due to API rate limits. 
Your request: "${lastMessage.content}"
Please try again in a moment when API limits reset.

In the meantime, I can help with basic navigation tasks without complex function calls.`;
    
    return new AIMessage(text);
  }

  // Override withStructuredOutput to work with our wrapper
  withStructuredOutput(schema: any, config?: any): any {
    console.log('[GeminiChatModel] Creating structured output wrapper using GeminiWrapper');
    
    // Return a wrapper that will use our invoke method with the schema
    return {
      invoke: async (messages: BaseMessage[], options?: any) => {
        try {
          console.log('[GeminiChatModel] Structured output invoke - converting schema to tools');
          // Add schema to generation config for function calling
          const generationConfig = {
            ...options?.generationConfig,
            // For Gemini, tools are used for structured output
          };

          const result = await this.invoke(messages, {
            ...options,
            generationConfig,
            // Convert schema to tools for Gemini
            tools: this._convertSchemaToTools(schema, config?.name),
          });

          console.log('[GeminiChatModel] Structured output invoke - extracting structured data');
          // Try to extract structured data from the response
          const parsed = this._extractStructuredOutput(result, schema);
          
          return {
            parsed,
            raw: result,
          };
        } catch (error) {
          console.error('[GeminiChatModel] Error in structured output:', error);
          throw error;
        }
      },
    };
  }

  // Helper: Convert LangChain messages to Gemini format
  private _convertMessagesToGeminiFormat(messages: BaseMessage[]): any[] {
    return messages.map((message) => {
      const content = message.content as string;
      const messageType = message._getType();
      
      // Handle different message types
      if (messageType === 'human' || messageType === 'user') {
        return {
          role: 'user',
          parts: [{ text: content }],
        };
      } else if (messageType === 'ai' || messageType === 'assistant') {
        return {
          role: 'model',
          parts: [{ text: content }],
        };
      } else if (messageType === 'system') {
        // System messages in Gemini are typically added as user messages with a prefix
        return {
          role: 'user',
          parts: [{ text: `System: ${content}` }],
        };
      } else {
        // Default to user role for unknown types
        return {
          role: 'user',
          parts: [{ text: content }],
        };
      }
    });
  }

  // Helper: Convert Gemini response back to LangChain format
  private _convertGeminiResponseToLangChainMessage(result: any): any {
    const response = result.response;
    
    if (!response) {
      throw new Error('No response from Gemini API');
    }

    const text = response.text();
    
    // Check for function calls
    const functionCalls = response.functionCalls();
    
    if (functionCalls && functionCalls.length > 0) {
      // Return a message with function calls
      return {
        content: text || '',
        additional_kwargs: {
          function_calls: functionCalls.map((fc: any) => ({
            name: fc.name,
            arguments: JSON.stringify(fc.args),
          })),
        },
      };
    }

    // Return regular text message
    return new AIMessage(text);
  }

  // Helper: Convert JSON schema to Gemini tools format
  private _convertSchemaToTools(schema: any, name?: string): any[] {
    if (!schema) return [];

    return [
      {
        functionDeclaration: {
          name: name || 'extract_structured_data',
          description: 'Extract structured data from the conversation',
          parameters: schema,
        },
      },
    ];
  }

  // Helper: Extract structured output from response
  private _extractStructuredOutput(response: any, schema: any): any {
    try {
      // If response has function calls, extract from there
      if (response.additional_kwargs?.function_calls) {
        const functionCall = response.additional_kwargs.function_calls[0];
        if (functionCall.arguments) {
          return JSON.parse(functionCall.arguments);
        }
      }

      // Otherwise, try to extract JSON from text content
      if (typeof response.content === 'string') {
        // Look for JSON in the content
        const jsonMatch = response.content.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[1]);
        }

        // Try to parse the entire content as JSON
        try {
          return JSON.parse(response.content);
        } catch {
          // Not valid JSON, return null
        }
      }

      return null;
    } catch (error) {
      console.error('[GeminiChatModel] Error extracting structured output:', error);
      return null;
    }
  }
}

// create a chat model based on the agent name, the model name and provider
export function createChatModel(providerConfig: ProviderConfig, modelConfig: ModelConfig): BaseChatModel {
  const temperature = (modelConfig.parameters?.temperature ?? 0.1) as number;
  const topP = (modelConfig.parameters?.topP ?? 0.1) as number;

  // Check if the provider is an Azure provider with a custom ID (e.g. azure_openai_2)
  const isAzure = isAzureProvider(modelConfig.provider);

  // If this is any type of Azure provider, handle it with the dedicated function
  if (isAzure) {
    return createAzureChatModel(providerConfig, modelConfig);
  }

  switch (modelConfig.provider) {
    case ProviderTypeEnum.OpenAI: {
      // Call helper without extra options
      return createOpenAIChatModel(providerConfig, modelConfig, undefined);
    }
    case ProviderTypeEnum.Anthropic: {
      // For Opus models, only include temperature, not topP
      const args = isAnthropicOpusModel(modelConfig.modelName)
        ? {
            model: modelConfig.modelName,
            apiKey: providerConfig.apiKey,
            maxTokens,
            temperature,
            clientOptions: {},
          }
        : {
            model: modelConfig.modelName,
            apiKey: providerConfig.apiKey,
            maxTokens,
            temperature,
            topP,
            clientOptions: {},
          };
      return new ChatAnthropic(args);
    }
    case ProviderTypeEnum.DeepSeek: {
      const args = {
        model: modelConfig.modelName,
        apiKey: providerConfig.apiKey,
        temperature,
        topP,
      };
      return new ChatDeepSeek(args) as BaseChatModel;
    }
    case ProviderTypeEnum.Gemini: {
      // Use GeminiWrapper with rate limiting instead of direct ChatGoogleGenerativeAI
      const args = {
        model: modelConfig.modelName,
        apiKey: providerConfig.apiKey,
        temperature,
        topP,
      };
      console.log('[createChatModel] Creating Gemini model with rate limiting and retry logic');
      return new GeminiChatModel(args);
    }
    case ProviderTypeEnum.Grok: {
      const args = {
        model: modelConfig.modelName,
        apiKey: providerConfig.apiKey,
        temperature,
        topP,
        maxTokens,
        configuration: {},
      };
      return new ChatXAI(args) as BaseChatModel;
    }
    case ProviderTypeEnum.Groq: {
      const args = {
        model: modelConfig.modelName,
        apiKey: providerConfig.apiKey,
        temperature,
        topP,
        maxTokens,
      };
      return new ChatGroq(args);
    }
    case ProviderTypeEnum.Cerebras: {
      const args = {
        model: modelConfig.modelName,
        apiKey: providerConfig.apiKey,
        temperature,
        topP,
        maxTokens,
      };
      return new ChatCerebras(args);
    }
    case ProviderTypeEnum.Ollama: {
      const args: {
        model: string;
        apiKey?: string;
        baseUrl: string;
        modelKwargs?: { max_completion_tokens: number };
        topP?: number;
        temperature?: number;
        maxTokens?: number;
        numCtx: number;
      } = {
        model: modelConfig.modelName,
        // required but ignored by ollama
        apiKey: providerConfig.apiKey === '' ? 'ollama' : providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl ?? 'http://localhost:11434',
        topP,
        temperature,
        maxTokens,
        // ollama usually has a very small context window, so we need to set a large number for agent to work
        // It was set to 128000 in the original code, but it will cause ollama reload the models frequently if you have multiple models working together
        // not sure why, but setting it to 64000 seems to work fine
        // TODO: configure the context window size in model config
        numCtx: 64000,
      };
      return new ChatOllama(args);
    }
    case ProviderTypeEnum.OpenRouter: {
      // Call the helper function, passing OpenRouter headers via the third argument
      console.log('[createChatModel] Calling createOpenAIChatModel for OpenRouter');
      return createOpenAIChatModel(providerConfig, modelConfig, {
        headers: {
          'HTTP-Referer': 'https://nanobrowser.ai',
          'X-Title': 'Nanobrowser',
        },
      });
    }
    case ProviderTypeEnum.Llama: {
      // Llama API has a different response format, use custom ChatLlama class
      const args: {
        model: string;
        apiKey?: string;
        configuration?: Record<string, unknown>;
        topP?: number;
        temperature?: number;
        maxTokens?: number;
      } = {
        model: modelConfig.modelName,
        apiKey: providerConfig.apiKey,
        topP: (modelConfig.parameters?.topP ?? 0.1) as number,
        temperature: (modelConfig.parameters?.temperature ?? 0.1) as number,
        maxTokens,
      };

      const configuration: Record<string, unknown> = {};
      if (providerConfig.baseUrl) {
        configuration.baseURL = providerConfig.baseUrl;
      }
      args.configuration = configuration;

      return new ChatLlama(args);
    }
    default: {
      // by default, we think it's a openai-compatible provider
      // Pass undefined for extraFetchOptions for default/custom cases
      return createOpenAIChatModel(providerConfig, modelConfig, undefined);
    }
  }
}
