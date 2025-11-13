import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NavigatorAgent, NavigatorActionRegistry } from '../navigator';
import { Action } from '../../actions/builder';
import { ActionResult } from '../../types';
import { createLogger } from '@src/background/log';

// Mock action that always fails
class FailingAction extends Action {
  constructor(name: string) {
    super(
      async () => {
        throw new Error(`Action ${name} failed`);
      },
      { name, schema: {} as any },
      false,
    );
  }
}

// Mock action that succeeds
class SuccessAction extends Action {
  constructor(name: string, returnValue: string = 'success') {
    super(
      async () => {
        return new ActionResult({
          extractedContent: returnValue,
          includeInMemory: true,
        });
      },
      { name, schema: {} as any },
      false,
    );
  }
}

describe('NavigatorAgent Action Fallback Mechanisms', () => {
  let navigatorAgent: NavigatorAgent;
  let actionRegistry: NavigatorActionRegistry;
  let mockContext: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock context
    mockContext = {
      browserContext: {
        getState: vi.fn().mockResolvedValue({
          elementTree: {},
          selectorMap: new Map(),
        }),
        removeHighlight: vi.fn(),
      },
      paused: false,
      stopped: false,
      emitEvent: vi.fn(),
    };

    // Create actions
    const actions = [
      new FailingAction('extract_text_from_screenshot'),
      new SuccessAction('cache_content', 'DOM fallback successful'),
      new FailingAction('click_element'),
      new SuccessAction('send_keys', 'Keyboard fallback successful'),
      new FailingAction('find_text_on_screen'),
      new SuccessAction('scroll_to_text', 'Scroll fallback successful'),
    ];

    actionRegistry = new NavigatorActionRegistry(actions);
    
    // Create navigator agent
    navigatorAgent = new NavigatorAgent(
      actionRegistry,
      {
        chatLLM: {} as any,
        context: mockContext,
        prompt: {} as any,
      },
    );
  });

  it('should fallback from OCR to cache_content', async () => {
    const actions = [
      { extract_text_from_screenshot: { intent: 'Extract text' } },
    ];

    const results = await (navigatorAgent as any).doMultiAction(actions);

    expect(results).toHaveLength(1);
    expect(results[0].extractedContent).toBe('DOM fallback successful');
  });

  it('should fallback from click_element to send_keys', async () => {
    const actions = [
      { click_element: { intent: 'Click button', index: 1 } },
    ];

    const results = await (navigatorAgent as any).doMultiAction(actions);

    expect(results).toHaveLength(1);
    expect(results[0].extractedContent).toBe('Keyboard fallback successful');
  });

  it('should fallback from find_text_on_screen to scroll_to_text', async () => {
    const actions = [
      { find_text_on_screen: { intent: 'Find text', searchText: 'Search Text' } },
    ];

    const results = await (navigatorAgent as any).doMultiAction(actions);

    expect(results).toHaveLength(1);
    expect(results[0].extractedContent).toBe('Scroll fallback successful');
  });

  it('should return null for unsupported action fallbacks', async () => {
    const getFallbackMethod = (navigatorAgent as any).getFallbackAction.bind(navigatorAgent);
    
    const fallback = getFallbackMethod('unsupported_action', {});
    
    expect(fallback).toBeNull();
  });

  it('should handle fallback failure gracefully', async () => {
    // Create registry where both primary and fallback actions fail
    const failingRegistry = new NavigatorActionRegistry([
      new FailingAction('extract_text_from_screenshot'),
      new FailingAction('cache_content'), // Fallback also fails
    ]);

    const failingNavigator = new NavigatorAgent(
      failingRegistry,
      {
        chatLLM: {} as any,
        context: mockContext,
        prompt: {} as any,
      },
    );

    const actions = [
      { extract_text_from_screenshot: { intent: 'Extract text' } },
    ];

    await expect((failingNavigator as any).doMultiAction(actions)).rejects.toThrow();
  });

  it('should log fallback attempts', async () => {
    const loggerSpy = vi.spyOn(createLogger('NavigatorAgent'), 'warn');
    const infoSpy = vi.spyOn(createLogger('NavigatorAgent'), 'info');

    const actions = [
      { extract_text_from_screenshot: { intent: 'Extract text' } },
    ];

    await (navigatorAgent as any).doMultiAction(actions);

    expect(loggerSpy).toHaveBeenCalledWith(
      '[Action] Failed, trying fallback',
      expect.any(Object)
    );
    expect(infoSpy).toHaveBeenCalledWith(
      '[Action] Using fallback',
      expect.any(Object)
    );
  });
});