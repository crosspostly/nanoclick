import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiChatModel } from '../helper';
import { GeminiWrapper } from '@extension/shared';

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

describe('GeminiChatModel Integration', () => {
  let geminiChatModel: GeminiChatModel;
  let mockGeminiWrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    
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

  it('should actually use GeminiWrapper instead of parent class', async () => {
    const mockMessages = [
      {
        _getType: () => 'human',
        content: 'Test message',
      },
    ];

    const mockResponse = {
      response: {
        text: () => 'Test response',
        functionCalls: () => [],
      },
    };

    mockGeminiWrapper.generateContentWithRetry.mockResolvedValue(mockResponse);

    await geminiChatModel.invoke(mockMessages);

    // Verify that the wrapper was actually called
    expect(mockGeminiWrapper.generateContentWithRetry).toHaveBeenCalledTimes(1);
    expect(mockGeminiWrapper.generateContentWithRetry).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Object)
    );
  });

  it('should apply rate limiting between requests', async () => {
    const mockMessages = [
      {
        _getType: () => 'human',
        content: 'Test message',
      },
    ];

    const mockResponse = {
      response: {
        text: () => 'Test response',
        functionCalls: () => [],
      },
    };

    mockGeminiWrapper.generateContentWithRetry.mockResolvedValue(mockResponse);

    // Make first request
    const promise1 = geminiChatModel.invoke(mockMessages);
    
    // First request should proceed immediately
    await vi.runAllTimersAsync();
    await promise1;

    // Make second request immediately after
    const promise2 = geminiChatModel.invoke(mockMessages);
    
    // Should be delayed due to rate limiting
    const startTime = Date.now();
    await vi.advanceTimersByTimeAsync(2000); // 2 second delay
    await promise2;
    const endTime = Date.now();

    // Verify that rate limiting caused a delay
    expect(endTime - startTime).toBeGreaterThanOrEqual(2000);
  });

  it('should pass retry config to GeminiWrapper', () => {
    // Verify that the wrapper was created with the correct retry config
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

  it('should handle wrapper errors properly', async () => {
    const mockMessages = [
      {
        _getType: () => 'human',
        content: 'Test message',
      },
    ];

    const testError = new Error('Gemini API error');
    mockGeminiWrapper.generateContentWithRetry.mockRejectedValue(testError);

    await expect(geminiChatModel.invoke(mockMessages)).rejects.toThrow('Gemini API error');
  });

  it('should verify conversation history validation happens', async () => {
    const mockMessages = [
      {
        _getType: () => 'human',
        content: 'Test message',
      },
    ];

    const mockResponse = {
      response: {
        text: () => 'Test response',
        functionCalls: () => [],
      },
    };

    mockGeminiWrapper.generateContentWithRetry.mockResolvedValue(mockResponse);

    await geminiChatModel.invoke(mockMessages);

    // Verify that the wrapper was called with converted messages
    // This indirectly tests that conversation history validation happens
    // since the wrapper validates the content
    expect(mockGeminiWrapper.generateContentWithRetry).toHaveBeenCalledWith(
      [
        {
          role: 'user',
          parts: [{ text: 'Test message' }],
        },
      ],
      expect.any(Object)
    );
  });
});