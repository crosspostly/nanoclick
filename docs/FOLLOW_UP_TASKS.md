# Follow-up Tasks: OCR & Gemini Free Tier Optimization

## 🎯 Immediate Actions (Week 1)

### Task 1: Install Missing Dependencies
**Priority**: 🔴 Critical  
**Effort**: 2 hours  
**Assignee**: TBD  
**Due**: 2025-06-24

#### Description
Install tesseract.js dependency to enable OCR functionality.

#### Implementation
```json
// Add to packages/shared/package.json
{
  "dependencies": {
    "tesseract.js": "^5.0.0"
  }
}
```

#### Acceptance Criteria
- [ ] tesseract.js@^5.0.0 added to packages/shared/package.json
- [ ] `pnpm install` completes successfully
- [ ] OCRWrapper can be imported without errors
- [ ] Basic OCR initialization works

---

### Task 2: Basic OCR Integration
**Priority**: 🔴 Critical  
**Effort**: 1 day  
**Assignee**: TBD  
**Due**: 2025-06-24

#### Description
Integrate OCRWrapper into agent actions to enable basic text extraction from screenshots.

#### Implementation Steps
1. Add OCR action schema to `chrome-extension/src/background/agent/actions/schemas.ts`
2. Implement extractTextFromScreenshot action in `chrome-extension/src/background/agent/actions/builder.ts`
3. Add OCR action to buildDefaultActions method
4. Test OCR functionality with screenshots

#### Code Changes Required
```typescript
// Add to schemas.ts
export const extractTextActionSchema: ActionSchema = {
  name: 'extract_text_from_screenshot',
  description: 'Extract all text from current page screenshot using OCR',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    useCache: z.boolean().default(true).describe('use cached OCR results if available'),
  }),
};

// Add to builder.ts
const extractTextFromScreenshot = new Action(async (input) => {
  const page = await this.context.browserContext.getCurrentPage();
  const screenshot = await page.takeScreenshot();
  const ocrWrapper = new OCRWrapper({ engine: 'tesseract' });
  const text = await ocrWrapper.extractText(screenshot, input.useCache);
  return new ActionResult({ extractedContent: text || 'No text found' });
}, extractTextActionSchema);
```

#### Acceptance Criteria
- [ ] OCR action schema defined
- [ ] OCR action implemented in ActionBuilder
- [ ] OCR can extract text from screenshots
- [ ] Action is available to Navigator agent
- [ ] Basic testing confirms functionality

---

### Task 3: Basic Rate Limiting for Gemini
**Priority**: 🔴 Critical  
**Effort**: 1 day  
**Assignee**: TBD  
**Due**: 2025-06-24

#### Description
Implement basic rate limiting to prevent hitting Gemini free tier limits (30 req/min).

#### Implementation
```typescript
// Add to chrome-extension/src/background/agent/helper.ts
class GeminiRateLimiter {
  private lastRequest = 0;
  private readonly minInterval = 2000; // 30 requests per minute

  async execute<T>(request: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequest;
    
    if (timeSinceLastRequest < this.minInterval) {
      const waitTime = this.minInterval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequest = Date.now();
    return request();
  }
}

// Update Gemini provider case
case ProviderTypeEnum.Gemini: {
  const rateLimiter = new GeminiRateLimiter();
  return rateLimiter.execute(() => new ChatGoogleGenerativeAI(args));
}
```

#### Acceptance Criteria
- [ ] GeminiRateLimiter class implemented
- [ ] Rate limiting applied to Gemini requests
- [ ] Maximum 30 requests per minute enforced
- [ ] No impact on other providers
- [ ] Logging shows rate limiting in action

---

## 🚀 Phase 2: Full Integration (Week 2-3)

### Task 4: Complete OCR Actions Suite
**Priority**: 🟡 High  
**Effort**: 2 days  
**Assignee**: TBD  
**Due**: 2025-07-01

#### Description
Implement full OCR action suite including text finding, button detection, and region extraction.

#### Actions to Implement
1. `find_text_on_screen` - Find text coordinates
2. `find_buttons_on_screen` - Detect clickable buttons
3. `extract_text_regions` - Get text with coordinates
4. `ocr_click_element` - Click element found via OCR

#### Acceptance Criteria
- [ ] All OCR actions implemented
- [ ] Text finding works with coordinates
- [ ] Button detection recognizes common button text
- [ ] Region extraction provides bounding boxes
- [ ] OCR-based clicking functional

---

### Task 5: GeminiWrapper Migration
**Priority**: 🟡 High  
**Effort**: 2 days  
**Assignee**: TBD  
**Due**: 2025-07-01

#### Description
Replace LangChain ChatGoogleGenerativeAI with custom GeminiWrapper for better free tier optimization.

#### Implementation Steps
1. Update helper.ts to use GeminiWrapper
2. Implement proper error handling and retries
3. Add conversation history management
4. Test with existing agent workflows

#### Acceptance Criteria
- [ ] GeminiWrapper integrated in helper.ts
- [ ] All existing agent functionality works
- [ ] Retry logic handles API errors
- [ ] Conversation history properly managed
- [ ] Performance monitoring added

---

### Task 6: Fallback Mechanisms
**Priority**: 🟡 High  
**Effort**: 2 days  
**Assignee**: TBD  
**Due**: 2025-07-01

#### Description
Implement fallback mechanisms when OCR or APIs are unavailable.

#### Fallback Strategies
1. OCR → DOM-based text search
2. Gemini → Other LLM providers
3. API failures → Local processing
4. Network issues → Offline mode

#### Acceptance Criteria
- [ ] OCR fallback to DOM search
- [ ] LLM provider fallback chain
- [ ] Graceful degradation when APIs fail
- [ ] User notifications for fallback usage
- [ ] Error recovery mechanisms

---

## 🔧 Phase 3: Optimization (Week 4)

### Task 7: Advanced Caching
**Priority**: 🟢 Medium  
**Effort**: 1 day  
**Assignee**: TBD  
**Due**: 2025-07-08

#### Description
Implement intelligent caching for OCR results and API responses.

#### Caching Strategy
1. OCR result caching with image hash
2. API response caching for common prompts
3. LRU cache with size limits
4. Cache invalidation on page changes

#### Acceptance Criteria
- [ ] OCR results cached by image hash
- [ ] API responses cached when appropriate
- [ ] Cache size limits enforced
- [ ] Cache invalidation working
- [ ] Performance improvement measurable

---

### Task 8: Usage Monitoring
**Priority**: 🟢 Medium  
**Effort**: 1 day  
**Assignee**: TBD  
**Due**: 2025-07-08

#### Description
Add monitoring and tracking for API usage to prevent limit exhaustion.

#### Metrics to Track
1. Gemini requests per minute/hour/day
2. OCR requests per day
3. Cache hit/miss ratios
4. Error rates and fallback usage

#### Acceptance Criteria
- [ ] Request counters implemented
- [ ] Usage metrics logged
- [ ] Rate limit warnings generated
- [ ] Analytics integration working
- [ ] User-facing usage display

---

## 📚 Documentation Tasks

### Task 9: Update Integration Guides
**Priority**: 🟢 Low  
**Effort**: 4 hours  
**Assignee**: TBD  
**Due**: 2025-07-08

#### Description
Update all documentation to reflect new OCR and Gemini capabilities.

#### Documents to Update
1. README.md - Add OCR features
2. AGENTS.md - Document OCR actions
3. API.md - GeminiWrapper usage
4. CONTRIBUTING.md - Development setup

---

### Task 10: Create Troubleshooting Guide
**Priority**: 🟢 Low  
**Effort**: 4 hours  
**Assignee**: TBD  
**Due**: 2025-07-08

#### Description
Create troubleshooting guide for common OCR and Gemini issues.

#### Topics to Cover
1. OCR accuracy problems
2. API rate limit issues
3. Performance optimization
4. Configuration troubleshooting

---

## 🏗️ Infrastructure Tasks

### Task 11: Add OCR Testing
**Priority**: 🟡 High  
**Effort**: 1 day  
**Assignee**: TBD  
**Due**: 2025-07-01

#### Description
Create comprehensive test suite for OCR functionality.

#### Test Coverage
1. OCR text extraction accuracy
2. Button detection precision
3. Performance benchmarks
4. Error handling scenarios

---

### Task 12: Performance Benchmarking
**Priority**: 🟢 Medium  
**Effort**: 1 day  
**Assignee**: TBD  
**Due**: 2025-07-08

#### Description
Benchmark OCR and Gemini performance to identify optimization opportunities.

#### Metrics to Measure
1. OCR processing time per image
2. Gemini response times
3. Memory usage impact
4. Cache effectiveness

---

## 📋 Task Dependencies

```
Task 1 → Task 2 (OCR dependency required)
Task 3 → Task 5 (Rate limiting needed for GeminiWrapper)
Task 2 → Task 4 (Basic OCR needed for advanced actions)
Task 5 → Task 6 (GeminiWrapper needed for fallbacks)
Task 4,5,6 → Task 7 (Full integration needed for caching)
Task 7 → Task 8 (Caching needed for monitoring)
```

---

## 🎯 Success Metrics

### Phase 1 Success
- OCR functional in basic form
- Gemini rate limiting active
- No immediate API limit hits

### Phase 2 Success
- Full OCR action suite available
- GeminiWrapper fully integrated
- Fallback mechanisms working

### Phase 3 Success
- Performance optimized
- Usage monitoring active
- Documentation complete

---

## 🚨 Risks and Mitigations

### Technical Risks
1. **OCR Performance**: May impact browser performance
   - Mitigation: Add user controls and performance monitoring
2. **API Changes**: Gemini API may change
   - Mitigation: Implement flexible wrapper architecture
3. **Memory Usage**: Caching may increase memory usage
   - Mitigation: Implement cache size limits and cleanup

### Project Risks
1. **Timeline**: Complex integration may take longer
   - Mitigation: Prioritize critical features first
2. **Resources**: May need additional development resources
   - Mitigation: Focus on high-impact items first

---

## 📞 Contact Information

**Project Lead**: TBD  
**Technical Lead**: TBD  
**Product Owner**: TBD  

**Questions about this task list should be directed to the project lead.**

---

*Last Updated: 2025-06-17*  
*Next Review: After Phase 1 completion*