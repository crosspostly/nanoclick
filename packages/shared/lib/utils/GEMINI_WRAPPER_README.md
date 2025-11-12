# GeminiWrapper Usage Guide

## Problem Solved

This wrapper fixes the common error when using Gemini API with function calling:

```
[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent: [400 ] Invalid JSON payload received. Unknown name "args" at 'contents[12].parts[1].function_call': Proto field is not repeating, cannot start list.
```

## Root Cause

The error occurs when:
1. Using `function_call` (snake_case) instead of `functionCall` (camelCase)
2. Passing an array instead of an object for `args` or `response` fields
3. Improper conversation history format

## Features

✅ **Automatic Format Correction**
- Converts `function_call` → `functionCall`
- Converts `function_response` → `functionResponse`
- Wraps arrays in objects: `[...]` → `{ items: [...] }`

✅ **Retry Mechanism**
- 3 retries by default (configurable)
- Exponential backoff: 1s → 2s → 4s → 8s → 10s
- Smart retry logic (only retryable errors)

✅ **Fallback Strategies**
- Truncates history to last 6 messages if overflow
- Automatic data sanitization on retry
- Detailed error logging

✅ **Validation**
- Pre-flight validation of conversation history
- Detailed error messages for debugging
- Auto-fix for common issues

## Usage

### Basic Usage

```typescript
import { GeminiWrapper } from '@extension/shared';

const gemini = new GeminiWrapper({
  apiKey: process.env.GEMINI_API_KEY!,
  model: 'gemini-2.5-flash-lite',
  retryConfig: {
    maxRetries: 5,
    initialDelay: 1000,
    maxDelay: 10000,
    backoffMultiplier: 2,
  },
});

// Define tools
const tools = [
  {
    functionDeclarations: [
      {
        name: 'click_element',
        description: 'Click on an element',
        parameters: {
          type: 'object',
          properties: {
            elementId: { type: 'string' },
          },
          required: ['elementId'],
        },
      },
    ],
  },
];

// Function handler
const handleFunctionCall = async (fc: { name: string; args: any }) => {
  switch (fc.name) {
    case 'click_element':
      return { success: true, elementId: fc.args.elementId };
    default:
      return { error: `Unknown function: ${fc.name}` };
  }
};

// Run chat
const result = await gemini.chat(
  'Click on the submit button',
  tools,
  handleFunctionCall,
  10 // max turns
);

console.log('Final response:', result.finalResponse);
```

### Manual Conversation Building

```typescript
import { Content } from '@google/generative-ai';

let contents: Content[] = [
  {
    role: 'user',
    parts: [{ text: 'Find the login button' }],
  },
];

// Generate response
const result = await gemini.generateContentWithRetry(contents, { tools });

const functionCalls = result.response.functionCalls();

if (functionCalls) {
  for (const fc of functionCalls) {
    // Add function call to history
    contents = gemini.addFunctionCallToHistory(contents, {
      name: fc.name,
      args: fc.args,
    });

    // Execute function
    const functionResult = await handleFunctionCall(fc);

    // Add result to history
    contents = gemini.addFunctionResponseToHistory(
      contents,
      fc.name,
      functionResult
    );
  }
}

// Continue conversation
const nextResult = await gemini.generateContentWithRetry(contents, { tools });
```

### Integration with Existing Agent Code

If you have existing agent code that directly uses `GoogleGenerativeAI`:

**Before:**
```typescript
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
const result = await model.generateContent({ contents });
```

**After:**
```typescript
const gemini = new GeminiWrapper({ apiKey, model: 'gemini-2.5-flash-lite' });
const result = await gemini.generateContentWithRetry(contents, { tools });
```

## Configuration Options

```typescript
interface GeminiConfig {
  apiKey: string;              // Required
  model?: string;              // Default: 'gemini-2.5-flash-lite'
  retryConfig?: {
    maxRetries?: number;       // Default: 3
    initialDelay?: number;     // Default: 1000ms
    maxDelay?: number;         // Default: 10000ms
    backoffMultiplier?: number; // Default: 2
  };
}
```

## Error Handling

The wrapper automatically handles:
- ✅ 400 errors with "Invalid JSON payload" (sanitizes and retries)
- ✅ 429 rate limit errors (retries with backoff)
- ✅ 500+ server errors (retries with backoff)
- ✅ Conversation history overflow (truncates and retries)

## Debugging

The wrapper logs detailed information to console:

```
[Gemini] Validation errors: ["contents[12].parts[1]: functionCall.args must be object, not array"]
[Gemini] Retry attempt 1/3
[Gemini] Truncating history from 20 to 6 messages
```

Check console for these messages when debugging issues.

## Best Practices

1. **Always use the wrapper** instead of direct `GoogleGenerativeAI` calls
2. **Configure retries** based on your use case (more for production)
3. **Monitor logs** to catch and fix data format issues early
4. **Test edge cases** with malformed data to ensure robustness
5. **Keep history manageable** - the wrapper truncates to last 6 messages as fallback

## Migration Checklist

- [ ] Replace `GoogleGenerativeAI` imports with `GeminiWrapper`
- [ ] Update function call history formatting
- [ ] Update function response history formatting
- [ ] Test with existing conversation histories
- [ ] Configure retry parameters for your use case
- [ ] Monitor logs for validation errors

## Support

If you encounter issues:
1. Check console logs for validation errors
2. Verify your conversation history format
3. Ensure function responses are objects, not arrays
4. Try increasing `maxRetries` if hitting rate limits
