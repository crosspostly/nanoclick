# Changelog

All notable changes to Nanobrowser will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- OCR & Gemini Free Tier Audit Report - Comprehensive analysis of current implementation gaps
- OCRWrapper class implementation (not yet integrated)
- GeminiWrapper class implementation (not yet integrated)

### Security
- Critical: OCR and Gemini wrappers exist but are not integrated, creating potential security gaps
- Missing rate limiting for free API tiers could lead to rapid limit exhaustion

### Changed
- No functional changes - audit only

### Deprecated
- None

### Removed
- None

### Fixed
- None

### Security
- None

---

## [0.1.12] - Previous Release

### Added
- Multi-agent system with Navigator and Planner agents
- Chrome extension integration with Puppeteer
- LangChain integration for multiple LLM providers
- DOM-based element interaction
- Screenshot capabilities
- Speech-to-text service
- Analytics integration
- Multi-language support (i18n)

### Changed
- Updated agent execution flow
- Improved error handling
- Enhanced browser automation

### Fixed
- Fixed tab management issues
- Resolved memory leaks in agent execution
- Improved element detection accuracy

---

## [Future Roadmap]

### Version 0.2.0 - OCR Integration (Planned)
- **Critical**: Integrate OCRWrapper into agent actions
- Add OCR-based text extraction actions
- Implement OCR fallback mechanisms
- Add Tesseract.js dependency
- Optimize OCR performance for client-side processing

### Version 0.2.1 - Gemini Free Tier Optimization (Planned)
- **Critical**: Replace LangChain Gemini with GeminiWrapper
- Implement rate limiting for Gemini API (30 req/min)
- Add request queuing system
- Implement prompt caching for better performance
- Add usage monitoring and tracking

### Version 0.3.0 - Enhanced Free API Support (Planned)
- OCR.space API integration with rate limiting
- Google Vision API free tier optimization
- Smart fallback between OCR engines
- Batch processing for multiple OCR requests
- Advanced error handling and retry logic

### Version 0.4.0 - Performance & Monitoring (Planned)
- API usage dashboard
- Performance metrics for OCR processing
- Token usage optimization for all providers
- User-configurable rate limits
- Advanced caching strategies

---

## Known Issues

### Critical
- [OCR-001] OCRWrapper implemented but not integrated into agent system
- [GEM-001] GeminiWrapper implemented but not used by agents
- [RATE-001] No rate limiting for free API tiers
- [DEP-001] Missing tesseract.js dependency prevents OCR functionality

### High
- [PERF-001] OCR performance impact on browser performance not assessed
- [FALL-001] No fallback mechanisms when APIs are unavailable
- [MON-001] No monitoring of API usage or limits

### Medium
- [CACHE-001] No caching for OCR results or API responses
- [QUEUE-001] No request queuing system for rate-limited APIs
- [OPT-001] No token optimization for LLM providers

---

## Security Notes

### Current Concerns
- OCR screenshots may contain sensitive user data
- API keys stored in browser storage without encryption
- No input validation for OCR processing
- Missing rate limiting could lead to API abuse

### Mitigations Needed
- Implement input sanitization for OCR
- Add encryption for API keys
- Implement rate limiting and monitoring
- Add user consent for data processing

---

## Migration Guide

### For Version 0.2.0 (OCR Integration)
```bash
# Install new dependencies
pnpm add tesseract.js

# Update agent actions (manual integration required)
# See docs/OCR_QUALITY_REPORT.md for details
```

### For Version 0.2.1 (Gemini Optimization)
```typescript
// Old approach (will be deprecated)
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';

// New approach (recommended)
import { GeminiWrapper } from '@extension/shared';

const gemini = new GeminiWrapper({
  apiKey: 'your-api-key',
  model: 'gemini-2.5-flash-lite'
});
```

---

*This changelog will be updated as critical issues from the audit are addressed.*