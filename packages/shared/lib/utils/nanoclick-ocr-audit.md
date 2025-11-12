# Nanoclick: Полный чеклист аудита, интеграции OCR и улучшений

## 📋 Часть 1: Аудит безопасности и рисков

### 🔴 Критические риски (требуют немедленных действий)

- [ ] **API Keys Security**
  - [ ] Проверить, не хранятся ли ключи API в коде/логах
  - [ ] Убедиться, что `.env` файлы в `.gitignore`
  - [ ] Проверить, нет ли hardcoded API keys в репозитории (поиск по истории коммитов)
  - [ ] Внедрить валидацию API keys перед использованием
  - [ ] Добавить rate limiting для API вызовов

- [ ] **Data Privacy & Leaks**
  - [ ] Аудит всех мест, где создаются скриншоты (могут содержать личные данные)
  - [ ] Проверить, что history/sessions НЕ отправляются на внешние серверы без согласия
  - [ ] Убедиться, что sensitive data (пароли, токены) НЕ попадают в логи
  - [ ] Проверить storage permissions в manifest.json
  - [ ] Добавить фильтрацию чувствительных полей перед логированием

- [ ] **Chrome Extension Permissions**
  - [ ] Минимизировать permissions в manifest.json (принцип least privilege)
  - [ ] Удалить неиспользуемые permissions
  - [ ] Проверить host_permissions - нужен ли `<all_urls>`?
  - [ ] Документировать, зачем нужна каждая permission

- [ ] **Content Script Injection**
  - [ ] Проверить защиту от XSS при работе с DOM
  - [ ] Убедиться, что `innerHTML` не используется с непроверенными данными
  - [ ] Проверить sanitization всех данных от пользователя
  - [ ] Добавить Content Security Policy в manifest

### 🟡 Важные проблемы (требуют внимания)

- [ ] **Error Handling**
  - [ ] Проверить все `try-catch` блоки на корректность
  - [ ] Убедиться, что errors НЕ содержат sensitive info при логировании
  - [ ] Добавить global error handler в background script
  - [ ] Проверить handling сетевых ошибок (timeout, 429, 500+)

- [ ] **Memory Leaks**
  - [ ] Проверить cleanup listeners в `useEffect` cleanup functions
  - [ ] Убедиться, что все `setInterval/setTimeout` очищаются
  - [ ] Проверить, что все event listeners удаляются при unmount
  - [ ] Проверить, что connections (`chrome.runtime.connect`) закрываются
  - [ ] Аудит heartbeat intervals - нет ли утечек?

- [ ] **Function Calling API**
  - [ ] ✅ GeminiWrapper внедрен (PR #1 merged)
  - [ ] Мигрировать все агенты на GeminiWrapper
  - [ ] Проверить валидацию conversation history в других местах
  - [ ] Убедиться, что нет snake_case (`function_call` вместо `functionCall`)

- [ ] **Session & History Management**
  - [ ] Проверить лимиты на размер истории (предотвращение overflow)
  - [ ] Добавить TTL для старых sessions
  - [ ] Проверить корректность очистки истории при logout/clear
  - [ ] Добавить encryption для чувствительных данных в history

### 🟢 Желательные улучшения

- [ ] **Performance**
  - [ ] Проверить bundle size (особенно packages)
  - [ ] Lazy loading для тяжелых компонентов
  - [ ] Code splitting для улучшения load time
  - [ ] Проверить, нет ли избыточных re-renders в React компонентах

- [ ] **Testing**
  - [ ] Добавить unit tests для критических функций (GeminiWrapper, agents)
  - [ ] Добавить integration tests для function calling flow
  - [ ] E2E тесты для основных user scenarios
  - [ ] Stress testing для memory leaks

- [ ] **Logging & Monitoring**
  - [ ] Структурированное логирование (JSON format)
  - [ ] Отдельные log levels (debug, info, warn, error)
  - [ ] Добавить performance metrics
  - [ ] User consent для telemetry (если планируется)

---

## 📦 Часть 2: Интеграция OCR из crosspostly/click

### TypeScript OCR Wrapper (адаптация для Nanoclick)

**Создать файл: `packages/shared/lib/utils/ocr-wrapper.ts`**

```typescript
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

  /**
   * Get hash of image data for caching
   */
  private async getImageHash(imageData: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(imageData);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Extract text from base64 image
   */
  async extractText(imageBase64: string, useCache = true): Promise<string | null> {
    if (!this.isAvailable) {
      console.warn('[OCR] Engine not available');
      return null;
    }

    try {
      const imageHash = await this.getImageHash(imageBase64);

      // Check cache
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

      // Save to cache
      if (useCache && text) {
        this.cache.set(imageHash, text);
      }

      return text;
    } catch (error) {
      console.error('[OCR] Extract text error:', error);
      return null;
    }
  }

  /**
   * Extract text using Tesseract.js
   */
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

  /**
   * Extract text using OCR.space API
   */
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

  /**
   * Extract text using Google Cloud Vision API
   */
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

  /**
   * Extract text with regions (coordinates)
   */
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

  /**
   * Find text on screen and return coordinates
   */
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

  /**
   * Find buttons on screenshot by keywords
   */
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

    // Sort by confidence
    buttons.sort((a, b) => b.confidence - a.confidence);

    return buttons;
  }

  /**
   * Preprocess image for better OCR
   */
  async preprocessImage(imageBase64: string): Promise<string> {
    try {
      // This would require image manipulation library
      // For now, return as-is
      // TODO: Implement using canvas API or sharp library
      return imageBase64;
    } catch (error) {
      console.error('[OCR] Preprocess error:', error);
      return imageBase64;
    }
  }

  /**
   * Clear OCR cache
   */
  clearCache(): void {
    this.cache.clear();
    console.log('[OCR] Cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      entries: this.cache.size,
      engine: this.config.engine,
      languages: this.config.languages,
    };
  }

  /**
   * Set OCR languages
   */
  setLanguages(languages: string[]): void {
    this.config.languages = languages;
    console.log('[OCR] Languages updated:', languages.join(', '));
  }

  /**
   * Check if OCR is available
   */
  isOCRAvailable(): boolean {
    return this.isAvailable;
  }
}
```

### Интеграция в Nanoclick

**1. Установить зависимости:**

```json
// package.json (в packages/shared/)
{
  "dependencies": {
    "tesseract.js": "^5.0.0"
  }
}
```

**2. Создать action для OCR:**

```typescript
// chrome-extension/src/background/agent/actions/ocr-action.ts
import { OCRWrapper } from '@extension/shared';

export class OCRAction {
  private ocr: OCRWrapper;

  constructor() {
    this.ocr = new OCRWrapper({
      engine: 'tesseract',
      languages: ['eng', 'rus'],
      cacheEnabled: true,
    });
  }

  /**
   * Click on element by text (OCR-based)
   */
  async clickByText(screenshot: string, text: string): Promise<{ x: number; y: number } | null> {
    const result = await this.ocr.findTextOnScreen(screenshot, text);
    
    if (result) {
      console.log(`[OCR] Found "${text}" at (${result.x}, ${result.y})`);
      return { x: result.x, y: result.y };
    }

    console.warn(`[OCR] Text "${text}" not found`);
    return null;
  }

  /**
   * Find and click button by keyword
   */
  async clickButton(screenshot: string, keyword: string): Promise<{ x: number; y: number } | null> {
    const buttons = await this.ocr.findButtons(screenshot, [keyword]);
    
    if (buttons.length > 0) {
      const button = buttons[0];
      console.log(`[OCR] Found button "${button.text}" at (${button.x}, ${button.y})`);
      return { x: button.x, y: button.y };
    }

    console.warn(`[OCR] Button with keyword "${keyword}" not found`);
    return null;
  }
}
```

**3. Экспорт из utils:**

```typescript
// packages/shared/lib/utils/index.ts
export * from './shared-types';
export * from './gemini-wrapper';
export * from './ocr-wrapper';
```

### Чеклист интеграции OCR

- [ ] **Setup**
  - [ ] Установить `tesseract.js` dependency
  - [ ] Создать `ocr-wrapper.ts` в `packages/shared/lib/utils/`
  - [ ] Добавить export в `index.ts`
  - [ ] Создать `ocr-action.ts` в `chrome-extension/src/background/agent/actions/`

- [ ] **Базовые функции**
  - [ ] Реализовать `extractText()` с Tesseract.js
  - [ ] Реализовать `extractTextRegions()` для координат
  - [ ] Реализовать `findTextOnScreen()` для поиска
  - [ ] Реализовать `findButtons()` для кнопок
  - [ ] Добавить кэширование результатов

- [ ] **Интеграция с агентами**
  - [ ] Добавить OCR action в Navigator agent
  - [ ] Добавить команду `/ocr-click <text>` в executor
  - [ ] Добавить fallback: если DOM click не работает → пробовать OCR click
  - [ ] Логировать использование OCR для аналитики

- [ ] **Опциональные улучшения**
  - [ ] Добавить поддержку OCR.space API (cloud OCR)
  - [ ] Добавить поддержку Google Vision API
  - [ ] Реализовать preprocessImage() с canvas API
  - [ ] Добавить настройки OCR в options page
  - [ ] UI индикатор когда используется OCR

- [ ] **Тестирование**
  - [ ] Тест на простых кнопках (OK, Cancel)
  - [ ] Тест на русском тексте
  - [ ] Тест с низким качеством изображения
  - [ ] Performance test (время обработки)
  - [ ] Тест кэширования

---

## 🔧 Часть 3: Чеклист технических улучшений

### Архитектура

- [ ] **Модульность**
  - [ ] Выделить shared types в отдельный пакет
  - [ ] Создать @extension/actions для всех действий агента
  - [ ] Унифицировать error types
  - [ ] Добавить barrel exports для удобного импорта

- [ ] **State Management**
  - [ ] Проверить consistency между storage и React state
  - [ ] Добавить state synchronization между tabs
  - [ ] Проверить race conditions при параллельных операциях

- [ ] **Background Worker**
  - [ ] Проверить service worker lifecycle
  - [ ] Убедиться, что critical data не теряется при restart
  - [ ] Добавить proper cleanup при unload

### Code Quality

- [ ] **TypeScript**
  - [ ] Убрать все `any` types (заменить на proper types)
  - [ ] Добавить strict mode в tsconfig
  - [ ] Проверить missing type definitions
  - [ ] Добавить JSDoc комментарии для public API

- [ ] **Linting**
  - [ ] Исправить все ESLint warnings
  - [ ] Добавить pre-commit hooks (Husky)
  - [ ] Настроить Prettier
  - [ ] Включить strict linting rules

- [ ] **Dependencies**
  - [ ] Обновить все dependencies до latest
  - [ ] Проверить security vulnerabilities (`npm audit`)
  - [ ] Удалить неиспользуемые dependencies
  - [ ] Проверить bundle size после обновлений

### Documentation

- [ ] **README**
  - [ ] Добавить architecture diagram
  - [ ] Документировать API keys setup
  - [ ] Добавить troubleshooting section
  - [ ] Примеры использования для разработчиков

- [ ] **Code Comments**
  - [ ] Комментарии для сложной бизнес-логики
  - [ ] JSDoc для всех public methods
  - [ ] TODO комментарии с issue numbers
  - [ ] Объяснение архитектурных решений

- [ ] **Contributing Guide**
  - [ ] Code style guide
  - [ ] PR template
  - [ ] Issue templates
  - [ ] Development setup guide

---

## 🚀 Часть 4: Roadmap интеграции (рекомендуемый порядок)

### Фаза 1: Критические исправления (1-2 дня)
1. ✅ Fix Gemini function calling (DONE - PR #1)
2. Security audit API keys
3. Проверка data privacy/leaks
4. Fix memory leaks

### Фаза 2: OCR интеграция (2-3 дня)
1. Создать OCRWrapper TypeScript version
2. Интеграция с Navigator agent
3. Добавить OCR fallback для кликов
4. Тестирование OCR на разных языках

### Фаза 3: Миграция агентов (2-3 дня)
1. Мигрировать Navigator на GeminiWrapper
2. Мигрировать Planner на GeminiWrapper
3. Добавить валидацию истории везде
4. Cleanup старого кода

### Фаза 4: Качество и тесты (3-5 дней)
1. Unit tests для критических компонентов
2. E2E tests для основных scenarios
3. Performance optimization
4. Code quality improvements

### Фаза 5: Документация (1-2 дня)
1. Обновить README
2. API documentation
3. Architecture docs
4. Contributing guide

---

## 📊 Метрики успеха

### Безопасность
- ✅ Нет hardcoded API keys
- ✅ Все sensitive data encrypted/filtered
- ✅ Minimal permissions в manifest
- ✅ Нет утечек данных в логах

### Стабильность
- ✅ Нет memory leaks
- ✅ Нет uncaught errors
- ✅ Retry logic работает корректно
- ✅ Graceful degradation при ошибках

### Performance
- ✅ Bundle size < 2MB
- ✅ OCR response time < 3s
- ✅ API retry time < 30s total
- ✅ No blocking operations на UI thread

### Code Quality
- ✅ 0 ESLint errors
- ✅ TypeScript strict mode enabled
- ✅ Test coverage > 70%
- ✅ All dependencies up-to-date

---

## 🎯 Приоритеты

**MUST HAVE (сделать обязательно):**
- Security audit
- Memory leaks fix
- GeminiWrapper migration
- Basic OCR integration

**SHOULD HAVE (очень желательно):**
- Full test coverage
- OCR fallback механизм
- Performance optimization
- Documentation updates

**NICE TO HAVE (можно отложить):**
- Cloud OCR APIs
- Advanced preprocessing
- Telemetry
- Multi-language support enhancement

---

## ✅ Итоговый чеклист для старта

**Немедленно:**
1. [ ] Проверить API keys security
2. [ ] Audit data privacy
3. [ ] Fix memory leaks в listeners
4. [ ] Создать OCRWrapper TypeScript

**Эта неделя:**
1. [ ] Интегрировать OCR в Navigator
2. [ ] Мигрировать агентов на GeminiWrapper
3. [ ] Добавить unit tests
4. [ ] Обновить README

**Следующая неделя:**
1. [ ] E2E тесты
2. [ ] Performance optimization
3. [ ] Code quality pass
4. [ ] Documentation complete

---

**Готово! Этот чеклист покрывает все аспекты интеграции и аудита. Начните с критических пунктов и двигайтесь по приоритетам. Удачи! 🚀**
