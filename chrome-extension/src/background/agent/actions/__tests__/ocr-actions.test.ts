import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionBuilder } from '../builder';
import { ActionResult } from '../types';
import { ExecutionState, Actors } from '../../event/types';
import { OCRWrapper } from '@extension/shared';

// Mock OCRWrapper
vi.mock('@extension/shared', () => ({
  OCRWrapper: vi.fn().mockImplementation(() => ({
    isReady: vi.fn().mockReturnValue(true),
    extractTextRegions: vi.fn(),
    findTextOnScreen: vi.fn(),
  })),
}));

// Mock i18n
vi.mock('@extension/i18n', () => ({
  t: vi.fn((key: string, ...args: any[]) => {
    if (key === 'act_extractTextRegions_start') return 'Extracting text regions from screenshot';
    if (key === 'act_extractTextRegions_ok') return `Extracted ${args[0]} text regions from screenshot`;
    if (key === 'act_ocrClick_start') return `Finding and clicking "${args[0]}" via OCR`;
    if (key === 'act_ocrClick_ok') return `Successfully clicked "${args[0]}" at coordinates (${args[1]}, ${args[2]}) using ${args[3]} click`;
    if (key === 'act_ocrClick_textNotFound') return `Text "${args[0]}" not found on screen`;
    if (key === 'act_ocrClick_failed') return `Failed to click via OCR: ${args[0]}`;
    return key;
  }),
}));

describe('OCR Actions', () => {
  let actionBuilder: ActionBuilder;
  let mockContext: any;
  let mockBrowserContext: any;
  let mockPage: any;
  let mockExtractorLLM: any;

  beforeEach(() => {
    mockPage = {
      takeScreenshot: vi.fn().mockResolvedValue('base64-screenshot-data'),
      getPuppeteerPage: vi.fn().mockResolvedValue({
        mouse: {
          click: vi.fn().mockResolvedValue(undefined),
        },
      }),
    };

    mockBrowserContext = {
      getCurrentPage: vi.fn().mockResolvedValue(mockPage),
    };

    mockContext = {
      emitEvent: vi.fn(),
      browserContext: mockBrowserContext,
      options: { useVision: false },
    };

    mockExtractorLLM = {
      invoke: vi.fn(),
    };

    actionBuilder = new ActionBuilder(mockContext, mockExtractorLLM);
  });

  describe('extract_text_regions', () => {
    it('should extract text regions successfully', async () => {
      const mockRegions = [
        { text: 'Hello', bbox: [10, 20, 100, 30], confidence: 95 },
        { text: 'World', bbox: [10, 60, 100, 30], confidence: 88 },
      ];

      const mockOCR = new (OCRWrapper as any)();
      mockOCR.extractTextRegions.mockResolvedValue(mockRegions);

      const actions = actionBuilder.buildDefaultActions();
      const extractTextRegionsAction = actions.find(a => a.name() === 'extract_text_regions');

      expect(extractTextRegionsAction).toBeDefined();

      const result = await extractTextRegionsAction!.call({});

      expect(result).toBeInstanceOf(ActionResult);
      expect(result.extractedContent).toContain('Found 2 text regions');
      expect(result.extractedContent).toContain('Hello');
      expect(result.extractedContent).toContain('World');
      expect(mockContext.emitEvent).toHaveBeenCalledWith(
        Actors.NAVIGATOR,
        ExecutionState.ACT_OK,
        'Extracted 2 text regions from screenshot'
      );
    });

    it('should handle no text regions found', async () => {
      const mockOCR = new (OCRWrapper as any)();
      mockOCR.extractTextRegions.mockResolvedValue([]);

      const actions = actionBuilder.buildDefaultActions();
      const extractTextRegionsAction = actions.find(a => a.name() === 'extract_text_regions');

      const result = await extractTextRegionsAction!.call({});

      expect(result.extractedContent).toBe('No text regions found in screenshot');
    });

    it('should handle OCR not ready', async () => {
      const mockOCR = new (OCRWrapper as any)();
      mockOCR.isReady.mockReturnValue(false);

      const actions = actionBuilder.buildDefaultActions();
      const extractTextRegionsAction = actions.find(a => a.name() === 'extract_text_regions');

      const result = await extractTextRegionsAction!.call({});

      expect(result.error).toContain('OCR is not available');
      expect(mockContext.emitEvent).toHaveBeenCalledWith(
        Actors.NAVIGATOR,
        ExecutionState.ACT_FAIL,
        expect.any(String)
      );
    });
  });

  describe('ocr_click_element', () => {
    it('should find and click text successfully', async () => {
      const mockRegion = {
        text: 'Submit',
        bbox: [100, 200, 80, 30],
        confidence: 92,
      };

      const mockOCR = new (OCRWrapper as any)();
      mockOCR.findTextOnScreen.mockResolvedValue(mockRegion);

      const actions = actionBuilder.buildDefaultActions();
      const ocrClickAction = actions.find(a => a.name() === 'ocr_click_element');

      expect(ocrClickAction).toBeDefined();

      const result = await ocrClickAction!.call({ text: 'Submit' });

      expect(result).toBeInstanceOf(ActionResult);
      expect(result.extractedContent).toContain('Successfully clicked "Submit"');
      expect(result.extractedContent).toContain('(140.0, 215.0)');
      expect(result.extractedContent).toContain('using left click');
      expect(mockPage.getPuppeteerPage).toHaveBeenCalled();
      
      const puppeteerPage = await mockPage.getPuppeteerPage();
      expect(puppeteerPage.mouse.click).toHaveBeenCalledWith(140, 215, {
        button: 'left',
        clickCount: 1,
      });

      expect(mockContext.emitEvent).toHaveBeenCalledWith(
        Actors.NAVIGATOR,
        ExecutionState.ACT_OK,
        'OCR click successful'
      );
    });

    it('should handle right click', async () => {
      const mockRegion = {
        text: 'Menu',
        bbox: [50, 100, 60, 25],
        confidence: 90,
      };

      const mockOCR = new (OCRWrapper as any)();
      mockOCR.findTextOnScreen.mockResolvedValue(mockRegion);

      const actions = actionBuilder.buildDefaultActions();
      const ocrClickAction = actions.find(a => a.name() === 'ocr_click_element');

      const result = await ocrClickAction!.call({ 
        text: 'Menu', 
        clickType: 'right' 
      });

      expect(result.extractedContent).toContain('Successfully clicked "Menu"');
      expect(result.extractedContent).toContain('using right click');
      
      const puppeteerPage = await mockPage.getPuppeteerPage();
      expect(puppeteerPage.mouse.click).toHaveBeenCalledWith(80, 112.5, {
        button: 'right',
        clickCount: 1,
      });
    });

    it('should handle double click', async () => {
      const mockRegion = {
        text: 'File',
        bbox: [10, 20, 40, 20],
        confidence: 95,
      };

      const mockOCR = new (OCRWrapper as any)();
      mockOCR.findTextOnScreen.mockResolvedValue(mockRegion);

      const actions = actionBuilder.buildDefaultActions();
      const ocrClickAction = actions.find(a => a.name() === 'ocr_click_element');

      const result = await ocrClickAction!.call({ 
        text: 'File', 
        clickType: 'double' 
      });

      expect(result.extractedContent).toContain('Successfully clicked "File"');
      expect(result.extractedContent).toContain('using left click');
      
      const puppeteerPage = await mockPage.getPuppeteerPage();
      expect(puppeteerPage.mouse.click).toHaveBeenCalledWith(30, 30, {
        button: 'left',
        clickCount: 2,
      });
    });

    it('should handle text not found', async () => {
      const mockOCR = new (OCRWrapper as any)();
      mockOCR.findTextOnScreen.mockResolvedValue(null);

      const actions = actionBuilder.buildDefaultActions();
      const ocrClickAction = actions.find(a => a.name() === 'ocr_click_element');

      const result = await ocrClickAction!.call({ text: 'NotFound' });

      expect(result.extractedContent).toContain('Text "NotFound" not found on screen');
      expect(mockPage.getPuppeteerPage).not.toHaveBeenCalled();
    });

    it('should handle custom screenshot', async () => {
      const mockRegion = {
        text: 'Button',
        bbox: [0, 0, 50, 20],
        confidence: 85,
      };

      const mockOCR = new (OCRWrapper as any)();
      mockOCR.findTextOnScreen.mockResolvedValue(mockRegion);

      const actions = actionBuilder.buildDefaultActions();
      const ocrClickAction = actions.find(a => a.name() === 'ocr_click_element');

      const customScreenshot = 'custom-base64-data';
      await ocrClickAction!.call({ 
        text: 'Button', 
        screenshot: customScreenshot 
      });

      expect(mockPage.takeScreenshot).not.toHaveBeenCalled();
      expect(mockOCR.findTextOnScreen).toHaveBeenCalledWith(customScreenshot, 'Button');
    });
  });
});