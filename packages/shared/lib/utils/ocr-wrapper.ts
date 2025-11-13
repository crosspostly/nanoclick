/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * OCR Wrapper для Nanoclick
 * Портирован из crosspostly/click ocr_handler.py
 *
 * Поддержка:
 * - Web OCR API (OCR.space, Google Vision)
 * - Tesseract.js для client-side OCR
 */

export interface OCRConfig {
  engine: 'tesseract' | 'ocr.space' | 'google_vision';
  apiKey?: string;
  language?: string;
  useDOMFallback?: boolean;
}

export interface OCRResult {
  text: string;
  confidence?: number;
}

export interface TextRegion {
  text: string;
  bbox: [number, number, number, number]; // [x, y, width, height]
  confidence?: number;
}

export class OCRWrapper {
  private config: OCRConfig;
  private tesseract: any;
  private cache: Map<string, string> = new Map();
  private isAvailable = false;
  private useDOMFallback = true;

  constructor(config: OCRConfig & { useDOMFallback?: boolean }) {
    this.config = {
      language: 'eng',
      ...config,
    };
    this.useDOMFallback = config.useDOMFallback ?? true;
    this.initOCR();
  }

  /**
   * Initialize OCR engine
   * For tesseract.js, dynamically imports the library
   * For API-based engines, checks if API key is provided
   */
  private async initOCR() {
    if (this.config.engine === 'tesseract') {
      try {
        // Dynamically import Tesseract.js (client-side OCR)
        const Tesseract = await import('tesseract.js').catch(() => null);
        if (!Tesseract) {
          console.error('[OCR] tesseract.js not available - install with: pnpm add tesseract.js');
          this.isAvailable = false;
          return;
        }
        this.tesseract = Tesseract;
        this.isAvailable = true;
        console.log('[OCR] Tesseract.js initialized');
      } catch (error) {
        console.error('[OCR] Failed to load Tesseract.js:', error);
        this.isAvailable = false;
      }
    } else {
      // For API-based engines, just check if API key exists
      this.isAvailable = !!this.config.apiKey;
    }
  }

  private async getImageHash(imageData: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(imageData);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Extract all text from image with fallback to DOM
   */
  async extractText(imageData: string, useCache = true): Promise<string | null> {
    const startTime = Date.now();
    
    // Try OCR first
    try {
      const result = await this.extractTextFromOCR(imageData, useCache);
      if (result) {
        console.log('[OCR] OCR extraction successful');
        return result;
      }
    } catch (ocrError) {
      console.warn('[OCR] Failed, attempting DOM fallback', {
        error: ocrError instanceof Error ? ocrError.message : String(ocrError),
      });
      
      if (!this.useDOMFallback) {
        throw ocrError;
      }
      
      // Fallback: try DOM parsing
      try {
        const domText = await this.extractTextFromDOM();
        console.info('[OCR] DOM fallback successful');
        
        // Cache the DOM fallback result
        if (domText && useCache) {
          const hash = await this.getImageHash(imageData);
          this.cache.set(hash, domText);
        }
        
        return domText;
      } catch (domError) {
        console.error('[OCR] Both OCR and DOM fallback failed', {
          ocr_error: ocrError instanceof Error ? ocrError.message : String(ocrError),
          dom_error: domError instanceof Error ? domError.message : String(domError),
        });
        throw new Error('All text extraction methods failed');
      }
    }

    return null;
  }

  /**
   * Extract text using OCR engines only
   */
  private async extractTextFromOCR(imageData: string, useCache = true): Promise<string | null> {
    if (!this.isAvailable) {
      console.warn('[OCR] OCR engine not available');
      return null;
    }

    // Check cache
    if (useCache) {
      const hash = await this.getImageHash(imageData);
      if (this.cache.has(hash)) {
        console.log('[OCR] Using cached result');
        return this.cache.get(hash)!;
      }
    }

    let text: string | null = null;

    switch (this.config.engine) {
      case 'tesseract':
        text = await this.extractTextTesseract(imageData);
        break;
      case 'ocr.space':
        text = await this.extractTextOCRSpace(imageData);
        break;
      case 'google_vision':
        text = await this.extractTextGoogleVision(imageData);
        break;
    }

    // Cache result
    if (text && useCache) {
      const hash = await this.getImageHash(imageData);
      this.cache.set(hash, text);
    }

    return text;
  }

  /**
   * Extract text from DOM as fallback when OCR fails
   */
  private async extractTextFromDOM(): Promise<string> {
    try {
      // Try to get text from the current page's DOM
      if (typeof document !== 'undefined' && document.body) {
        // Browser environment
        const pageText = document.body.innerText || document.body.textContent || '';
        return pageText.trim();
      } else if (typeof globalThis !== 'undefined' && (globalThis as any).document?.body) {
        // Alternative global access
        const pageText = (globalThis as any).document.body.innerText || (globalThis as any).document.body.textContent || '';
        return pageText.trim();
      } else {
        // Fallback for non-browser environments
        console.warn('[OCR] DOM fallback not available in this environment');
        throw new Error('DOM extraction not available');
      }
    } catch (error) {
      console.error('[OCR] DOM extraction failed:', error);
      throw error;
    }
  }

  /**
   * Extract text using Tesseract.js
   */
  private async extractTextTesseract(imageData: string): Promise<string | null> {
    if (!this.tesseract) {
      return null;
    }
    try {
      const worker = await this.tesseract.createWorker(this.config.language);
      const result = await worker.recognize(imageData);
      await worker.terminate();
      return result.data.text;
    } catch (error) {
      console.error('[OCR] Tesseract error:', error);
      return null;
    }
  }

  /**
   * Extract text using OCR.space API
   */
  private async extractTextOCRSpace(imageBase64: string): Promise<string | null> {
    if (!this.config.apiKey) {
      return null;
    }
    try {
      const formData = new FormData();
      formData.append('base64Image', imageBase64);
      formData.append('language', this.config.language || 'eng');

      const response = await fetch('https://api.ocr.space/parse/image', {
        method: 'POST',
        headers: {
          apikey: this.config.apiKey,
        },
        body: formData,
      });

      const data = await response.json();
      if (data.ParsedResults && data.ParsedResults.length > 0) {
        return data.ParsedResults[0].ParsedText;
      }
      return null;
    } catch (error) {
      console.error('[OCR] OCR.space error:', error);
      return null;
    }
  }

  /**
   * Extract text using Google Vision API
   */
  private async extractTextGoogleVision(imageBase64: string): Promise<string | null> {
    if (!this.config.apiKey) {
      return null;
    }
    try {
      const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${this.config.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [
            {
              image: { content: imageBase64 },
              features: [{ type: 'TEXT_DETECTION' }],
            },
          ],
        }),
      });
      const data = await response.json();
      const annotations = data.responses?.[0]?.textAnnotations;
      return annotations?.[0]?.description || null;
    } catch (error) {
      console.error('[OCR] Google Vision error:', error);
      return null;
    }
  }

  /**
   * Find text on screen and return its coordinates
   */
  async findTextOnScreen(imageData: string, searchText: string): Promise<TextRegion | null> {
    if (!this.isAvailable) {
      return null;
    }

    if (this.config.engine === 'tesseract' && this.tesseract) {
      try {
        const worker = await this.tesseract.createWorker(this.config.language);
        const result = await worker.recognize(imageData);
        await worker.terminate();

        // Find matching text in results
        const words = result.data.words;
        for (const word of words) {
          if (word.text.toLowerCase().includes(searchText.toLowerCase())) {
            return {
              text: word.text,
              bbox: [word.bbox.x0, word.bbox.y0, word.bbox.x1 - word.bbox.x0, word.bbox.y1 - word.bbox.y0],
              confidence: word.confidence,
            };
          }
        }
      } catch (error) {
        console.error('[OCR] Find text error:', error);
      }
    }

    return null;
  }

  /**
   * Extract all text regions with their coordinates
   */
  async extractTextRegions(imageData: string): Promise<TextRegion[]> {
    if (!this.isAvailable) {
      return [];
    }

    if (this.config.engine === 'tesseract' && this.tesseract) {
      try {
        const worker = await this.tesseract.createWorker(this.config.language);
        const result = await worker.recognize(imageData);
        await worker.terminate();

        return result.data.words.map((word: any) => ({
          text: word.text,
          bbox: [word.bbox.x0, word.bbox.y0, word.bbox.x1 - word.bbox.x0, word.bbox.y1 - word.bbox.y0],
          confidence: word.confidence,
        }));
      } catch (error) {
        console.error('[OCR] Extract regions error:', error);
      }
    }

    return [];
  }

  /**
   * Check if OCR engine is available
   */
  isReady(): boolean {
    return this.isAvailable;
  }

  /**
   * Clear OCR cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}
