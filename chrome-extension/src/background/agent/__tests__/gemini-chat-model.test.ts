import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiChatModel } from '../helper';
import { GeminiWrapper } from '@extension/shared';
import type { BaseMessage } from '@langchain/core/messages';

// Mock the GeminiWrapper
vi.mock('@extension/shared', () => ({
  GeminiWrapper: vi.fn().mockImplementation(() => ({
    generateContentWithRetry: vi.fn(),
  })),
}));

// Mock ChatGoogleGenerativeAI
vi.mock('@langchain/google-genai', () => ({
  ChatGoogleGenerativeAI: vi.fn().mockImplementation(() => ({})),
}));

describe('GeminiChatModel', () => {
  let geminiChatModel: GeminiChatModel;
  let mockGeminiWrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Get the mocked GeminiWrapper instance
    const GeminiWrapperMock = vi.mocked(GeminiWrapper);
    mockGeminiWrapper = {
      generateContentWithRetry: vi.fn(),
    };
    GeminiWrapperMock.mockImplementation(() => mockGeminiWrapper);

    // Create the model
    geminiChatModel = new GeminiChatModel({
      apiKey: 'test-api-key',
      model: 'gemini-2.0-flash-exp',
      temperature: 0.1,
      topP: 0.1,
    });
  });

  it('should initialize GeminiWrapper with correct config', () => {
    expect(GeminiWrapper).toHaveBeenCalledWith({
      apiKey: 'test-api-key',
      model: 'gemini-2.0-flash-exp',
      retryConfig: {
        maxRetries: 3,
        initialDelay: 2000,
        maxDelay: 30000,
        backoffMultiplier: 2,
      },
    });
  });

  it('should use GeminiWrapper in invoke method', async () => {
    const mockMessages: BaseMessage[] = [
      {
        _getType: () => 'human',
        content: 'Hello, how are you?',
      } as BaseMessage,
    ];

    const mockGeminiResponse = {
      response: {
        text: () => 'I am doing well, thank you!',
        functionCalls: () => [],
      },
    };

    mockGeminiWrapper.generateContentWithRetry.mockResolvedValue(mockGeminiResponse);

    const result = await geminiChatModel.invoke(mockMessages);

    expect(mockGeminiWrapper.generateContentWithRetry).toHaveBeenCalledWith(
      [
        {
          role: 'user',
          parts: [{ text: 'Hello, how are you?' }],
        },
      ],
      {
        generationConfig: undefined,
        safetySettings: undefined,
        tools: undefined,
      }
    );

    expect(result.content).toBe('I am doing well, thank you!');
  });

  it('should handle function calls correctly', async () => {
    const mockMessages: BaseMessage[] = [
      {
        _getType: () => 'human',
        content: 'Call a test function',
      } as BaseMessage,
    ];

    const mockFunctionCall = {
      name: 'test_function',
      args: { param1: 'value1' },
    };

    const mockGeminiResponse = {
      response: {
        text: () => 'I will call the test function',
        functionCalls: () => [mockFunctionCall],
      },
    };

    mockGeminiWrapper.generateContentWithRetry.mockResolvedValue(mockGeminiResponse);

    const result = await geminiChatModel.invoke(mockMessages);

    expect(result.additional_kwargs.function_calls).toEqual([
      {
        name: 'test_function',
        arguments: JSON.stringify({ param1: 'value1' }),
      },
    ]);
  });

  it('should use withStructuredOutput correctly', async () => {
    const mockSchema = {
      type: 'object',
      properties: {
        answer: { type: 'string' },
      },
    };

    const mockMessages: BaseMessage[] = [
      {
        _getType: () => 'human',
        content: 'Extract structured data',
      } as BaseMessage,
    ];

    const mockGeminiResponse = {
      response: {
        text: () => '```json\n{"answer": "42"}\n```',
        functionCalls: () => [],
      },
    };

    mockGeminiWrapper.generateContentWithRetry.mockResolvedValue(mockGeminiResponse);

    const structuredModel = geminiChatModel.withStructuredOutput(mockSchema);
    const result = await structuredModel.invoke(mockMessages);

    expect(mockGeminiWrapper.generateContentWithRetry).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        tools: [
          {
            functionDeclaration: {
              name: 'extract_structured_data',
              description: 'Extract structured data from the conversation',
              parameters: mockSchema,
            },
          },
        ],
      })
    );

    expect(result.parsed).toEqual({ answer: '42' });
    expect(result.raw).toBeDefined();
  });

  it('should convert different message types correctly', async () => {
    const mockMessages: BaseMessage[] = [
      {
        _getType: () => 'system',
        content: 'You are a helpful assistant',
      } as BaseMessage,
      {
        _getType: () => 'human',
        content: 'Hello',
      } as BaseMessage,
      {
        _getType: () => 'ai',
        content: 'Hi there!',
      } as BaseMessage,
    ];

    const mockGeminiResponse = {
      response: {
        text: () => 'Response',
        functionCalls: () => [],
      },
    };

    mockGeminiWrapper.generateContentWithRetry.mockResolvedValue(mockGeminiResponse);

    await geminiChatModel.invoke(mockMessages);

    expect(mockGeminiWrapper.generateContentWithRetry).toHaveBeenCalledWith(
      [
        {
          role: 'user',
          parts: [{ text: 'System: You are a helpful assistant' }],
        },
        {
          role: 'user',
          parts: [{ text: 'Hello' }],
        },
        {
          role: 'model',
          parts: [{ text: 'Hi there!' }],
        },
      ],
      expect.any(Object)
    );
  });
});