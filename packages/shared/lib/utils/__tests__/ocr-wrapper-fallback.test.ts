import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OCRWrapper } from '../ocr-wrapper';

// Mock document object for DOM fallback tests
const mockDocument = {
  body: {
    innerText: 'Sample DOM text content for testing',
    textContent: 'Sample DOM text content for testing',
  },
};

describe('OCRWrapper Fallback Mechanisms', () => {
  let ocrWrapper: OCRWrapper;

  beforeEach(() => {
    // Reset document mock
    vi.stubGlobal('document', mockDocument);
  });

  it('should fallback to DOM when OCR fails', async () => {
    // Create OCR wrapper with DOM fallback enabled
    ocrWrapper = new OCRWrapper({
      engine: 'tesseract',
      useDOMFallback: true,
    });

    // Mock OCR to fail
    vi.spyOn(ocrWrapper as any, 'extractTextTesseract').mockRejectedValue(new Error('OCR failed'));

    const result = await ocrWrapper.extractText('fake-image-data');

    expect(result).toBe('Sample DOM text content for testing');
  });

  it('should not fallback to DOM when disabled', async () => {
    // Create OCR wrapper with DOM fallback disabled
    ocrWrapper = new OCRWrapper({
      engine: 'tesseract',
      useDOMFallback: false,
    });

    // Mock OCR to fail
    vi.spyOn(ocrWrapper as any, 'extractTextTesseract').mockRejectedValue(new Error('OCR failed'));

    await expect(ocrWrapper.extractText('fake-image-data')).rejects.toThrow('All text extraction methods failed');
  });

  it('should use OCR when successful', async () => {
    // Create OCR wrapper with DOM fallback enabled
    ocrWrapper = new OCRWrapper({
      engine: 'tesseract',
      useDOMFallback: true,
    });

    // Mock OCR to succeed
    vi.spyOn(ocrWrapper as any, 'extractTextTesseract').mockResolvedValue('OCR extracted text');

    const result = await ocrWrapper.extractText('fake-image-data');

    expect(result).toBe('OCR extracted text');
  });

  it('should cache DOM fallback results', async () => {
    // Create OCR wrapper with DOM fallback enabled
    ocrWrapper = new OCRWrapper({
      engine: 'tesseract',
      useDOMFallback: true,
    });

    // Mock OCR to fail and DOM extraction
    vi.spyOn(ocrWrapper as any, 'extractTextTesseract').mockRejectedValue(new Error('OCR failed'));
    vi.spyOn(ocrWrapper as any, 'getImageHash').mockResolvedValue('test-hash');

    const result1 = await ocrWrapper.extractText('fake-image-data');
    const result2 = await ocrWrapper.extractText('fake-image-data'); // Should use cache

    expect(result1).toBe('Sample DOM text content for testing');
    expect(result2).toBe('Sample DOM text content for testing');
  });
});