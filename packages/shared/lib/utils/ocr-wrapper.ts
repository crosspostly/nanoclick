/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * OCR Wrapper для Nanoclick
 * Портирован из crosspostly/click ocr_handler.py
 * 
 * Поддержка:
 * - Web OCR API (OCR.space, Google Vision)
 * - Tesseract.js для client-side OCR
 * - Кэширование результатов
 * - Поиск текста и кнопок на скриншотах
 */

interface OCRRegion {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

interface OCRResult {
  text: string;
  x: number;
  y: number;
  confidence: number;
}

interface ButtonResult extends OCRResult {
  keyword: string;
}

interface OCRConfig {
  apiKey?: string; // For OCR.space or Google Vision
  engine?: 'tesseract' | 'ocr.space' | 'google-vision';
  languages?: string[]; // ['eng', 'rus', 'spa', ...]
  cacheEnabled?: boolean;
}

export class OCRWrapper {
  private config: OCRConfig;
  private cache: Map<string, string>;
  private isAvailable: boolean = false;
  private tesseract: any = null;

  constructor(config: OCRConfig = {}) {
    this.config = {
      engine: 'tesseract',
      languages: ['eng', 'rus'],
      cacheEnabled: true,
      ...config,
    };

    this.cache = new Map();
    this.initOCR();
  }

  /**
   * Initialize OCR engine
   */
  private async initOCR() {
    if (this.config.engine === 'tesseract') {
      try {
        // Dynamically import Tesseract.js (client-side OCR)
        const Tesseract = await import('tesseract.js');
        this.tesseract = Tesseract;
        this.isAvailable = true;
        console.log('[OCR] Tesseract.js initialized');
      } catch (error) {
        console.error('[OCR] Failed to load Tesseract.js:', error);
        this.isAvailable = false;
      }
    } else {
      // For cloud OCR APIs, just check if API key exists
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

  async extractText(imageBase64: string, useCache = true): Promise<string | null> {
    if (!this.isAvailable) {
      console.warn('[OCR] Engine not available');
      return null;
    }

    try {
      const imageHash = await this.getImageHash(imageBase64);
      if (useCache && this.cache.has(imageHash)) {
        console.log('[OCR] Cache hit');
        return this.cache.get(imageHash)!;
      }
      let text: string | null = null;
      switch (this.config.engine) {
        case 'tesseract':
          text = await this.extractWithTesseract(imageBase64);
          break;
        case 'ocr.space':
          text = await this.extractWithOCRSpace(imageBase64);
          break;
        case 'google-vision':
          text = await this.extractWithGoogleVision(imageBase64);
          break;
        default:
          throw new Error(`Unknown OCR engine: ${this.config.engine}`);
      }
      if (useCache && text) {
        this.cache.set(imageHash, text);
      }
      return text;
    } catch (error) {
      console.error('[OCR] Extract text error:', error);
      return null;
    }
  }

  private async extractWithTesseract(imageBase64: string): Promise<string | null> {
    if (!this.tesseract) return null;
    try {
      const worker = await this.tesseract.createWorker(this.config.languages);
      const result = await worker.recognize(imageBase64);
      await worker.terminate();
      return result.data.text;
    } catch (error) {
      console.error('[OCR] Tesseract error:', error);
      return null;
    }
  }

  private async extractWithOCRSpace(imageBase64: string): Promise<string | null> {
    if (!this.config.apiKey) {
      console.error('[OCR] OCR.space API key missing');
      return null;
    }
    try {
      const formData = new FormData();
      formData.append('base64Image', `data:image/png;base64,${imageBase64}`);
      formData.append('language', this.config.languages?.join(',') || 'eng');
      formData.append('apikey', this.config.apiKey);
      const response = await fetch('https://api.ocr.space/parse/image', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (data.IsErroredOnProcessing) {
        throw new Error(data.ErrorMessage?.[0] || 'OCR processing failed');
      }
      return data.ParsedResults?.[0]?.ParsedText || null;
    } catch (error) {
      console.error('[OCR] OCR.space error:', error);
      return null;
    }
  }

  private async extractWithGoogleVision(imageBase64: string): Promise<string | null> {
    if (!this.config.apiKey) {
      console.error('[OCR] Google Vision API key missing');
      return null;
    }
    try {
      const response = await fetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${this.config.apiKey}`,
        {
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
        },
      );
      const data = await response.json();
      const annotations = data.responses?.[0]?.textAnnotations;
      return annotations?.[0]?.description || null;
    } catch (error) {
      console.error('[OCR] Google Vision error:', error);
      return null;
    }
  }

  async extractTextRegions(imageBase64: string): Promise<OCRRegion[]> {
    if (!this.isAvailable || this.config.engine !== 'tesseract') {
      console.warn('[OCR] Regions extraction only supported with Tesseract');
      return [];
    }
    try {
      const worker = await this.tesseract.createWorker(this.config.languages);
      const result = await worker.recognize(imageBase64);
      await worker.terminate();
      const regions: OCRRegion[] = result.data.words.map((word: any) => ({
        text: word.text,
        x: word.bbox.x0,
        y: word.bbox.y0,
        width: word.bbox.x1 - word.bbox.x0,
        height: word.bbox.y1 - word.bbox.y0,
        confidence: word.confidence,
      }));
      return regions;
    } catch (error) {
      console.error('[OCR] Extract regions error:', error);
      return [];
    }
  }

  async findTextOnScreen(imageBase64: string, searchText: string): Promise<OCRResult | null> {
    const regions = await this.extractTextRegions(imageBase64);
    const searchLower = searchText.toLowerCase().trim();
    for (const region of regions) {
      if (region.text.toLowerCase().includes(searchLower)) {
        const centerX = region.x + region.width / 2;
        const centerY = region.y + region.height / 2;
        return {
          text: region.text,
          x: Math.round(centerX),
          y: Math.round(centerY),
          confidence: region.confidence,
        };
      }
    }
    return null;
  }

  async findButtons(
    imageBase64: string,
    keywords: string[] = [
      'ok',
      'cancel',
      'yes',
      'no',
      'submit',
      'send',
      'close',
      'start',
      'stop',
      'next',
      'back',
      'save',
      'login',
      'signin',
    ],
  ): Promise<ButtonResult[]> {
    const regions = await this.extractTextRegions(imageBase64);
    const buttons: ButtonResult[] = [];
    for (const region of regions) {
      const textLower = region.text.toLowerCase().trim();
      for (const keyword of keywords) {
        if (textLower.includes(keyword.toLowerCase())) {
          const centerX = region.x + region.width / 2;
          const centerY = region.y + region.height / 2;
          buttons.push({
            text: region.text,
            keyword,
            x: Math.round(centerX),
            y: Math.round(centerY),
            confidence: region.confidence,
          });
          break;
        }
      }
    }
    buttons.sort((a, b) => b.confidence - a.confidence);
    return buttons;
  }

  async preprocessImage(imageBase64: string): Promise<string> {
    try {
      // This would require image manipulation library
      // For now, return as-is
      return imageBase64;
    } catch (error) {
      console.error('[OCR] Preprocess error:', error);
      return imageBase64;
    }
  }

  clearCache(): void {
    this.cache.clear();
    console.log('[OCR] Cache cleared');
  }

  getCacheStats() {
    return {
      entries: this.cache.size,
      engine: this.config.engine,
      languages: this.config.languages,
    };
  }

  setLanguages(languages: string[]): void {
    this.config.languages = languages;
    console.log('[OCR] Languages updated:', languages.join(', '));
  }

  isOCRAvailable(): boolean {
    return this.isAvailable;
  }
}
