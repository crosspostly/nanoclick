import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiChatModel } from '../../agent/helper';
import { BaseMessage, HumanMessage } from '@langchain/core/messages';

// Mock GeminiWrapper
vi.mock('@extension/shared', () => ({
  GeminiWrapper: vi.fn().mockImplementation(() => ({
    generateContentWithRetry: vi.fn(),
  })),
}));

describe('GeminiChatModel Fallback Mechanisms', () => {
  let geminiModel: GeminiChatModel;

  beforeEach(() => {
    vi.clearAllMocks();
    geminiModel = new GeminiChatModel({
      apiKey: 'test-key',
      model: 'gemini-2.5-flash-lite',
    });
  });

  it('should use cached response when rate limited', async () => {
    const messages: BaseMessage[] = [new HumanMessage('test message')];
    
    // Mock rate limit error
    const mockGeminiWrapper = (geminiModel as any).geminiWrapper;
    mockGeminiWrapper.generateContentWithRetry.mockRejectedValue({
      message: '429 quota exceeded',
      status: 429,
    });

    // Add a cached response
    const queryHash = btoa('test message').slice(0, 16);
    (geminiModel as any).responseCache.set(queryHash, {
      response: new HumanMessage('cached response'),
      timestamp: Date.now(),
    });

    const result = await geminiModel.invoke(messages);

    expect(result.content).toBe('cached response');
  });

  it('should generate simplified response when rate limited and no cache', async () => {
    const messages: BaseMessage[] = [new HumanMessage('test message')];
    
    // Mock rate limit error
    const mockGeminiWrapper = (geminiModel as any).geminiWrapper;
    mockGeminiWrapper.generateContentWithRetry.mockRejectedValue({
      message: '429 quota exceeded',
      status: 429,
    });

    const result = await geminiModel.invoke(messages);

    expect(result.content).toContain('operating in degraded mode');
    expect(result.content).toContain('test message');
  });

  it('should cache successful responses', async () => {
    const messages: BaseMessage[] = [new HumanMessage('test message')];
    
    // Mock successful response
    const mockGeminiWrapper = (geminiModel as any).geminiWrapper;
    const mockResponse = {
      response: {
        text: () => 'successful response',
        functionCalls: () => [],
      },
    };
    mockGeminiWrapper.generateContentWithRetry.mockResolvedValue(mockResponse);

    const result = await geminiModel.invoke(messages);

    expect(result.content).toBe('successful response');
    
    // Verify response was cached
    const queryHash = btoa('test message').slice(0, 16);
    const cached = (geminiModel as any).responseCache.get(queryHash);
    expect(cached).toBeDefined();
    expect(cached.response.content).toBe('successful response');
  });

  it('should not use stale cache (older than 5 minutes)', async () => {
    const messages: BaseMessage[] = [new HumanMessage('test message')];
    
    // Mock rate limit error
    const mockGeminiWrapper = (geminiModel as any).geminiWrapper;
    mockGeminiWrapper.generateContentWithRetry.mockRejectedValue({
      message: '429 quota exceeded',
      status: 429,
    });

    // Add stale cache (6 minutes old)
    const queryHash = btoa('test message').slice(0, 16);
    (geminiModel as any).responseCache.set(queryHash, {
      response: new HumanMessage('stale cached response'),
      timestamp: Date.now() - 6 * 60 * 1000, // 6 minutes ago
    });

    const result = await geminiModel.invoke(messages);

    expect(result.content).toContain('operating in degraded mode');
    expect(result.content).not.toContain('stale cached response');
  });
});