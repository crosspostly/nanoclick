// ... (previous code and imports remain the same)

// Updated GeminiChatModel _convertMessagesToGeminiFormat to handle advanced and structured messages
class GeminiChatModel extends ChatGoogleGenerativeAI {
  private geminiWrapper: GeminiWrapper;
  private rateLimiter: GeminiRateLimiter;
  private fallbackMode = false;
  private responseCache: Map<string, any> = new Map();

  constructor(args: any) {
    // ...constructor details as before
  }

  // ...invoke and other methods remain

  /**
   * Convert LangChain messages to Gemini Content[]
   * Handles advanced/structured case where message.content or message.additional_kwargs define function calls/tool outputs
   */
  private _convertMessagesToGeminiFormat(messages: BaseMessage[]): any[] {
    return messages.map(message => {
      const messageType = message._getType();
      // 1. Default to user/model role detection
      let role: 'user' | 'model' = (messageType === 'human' || messageType === 'user') ? 'user' : 'model';
      // 2. Add system messages as user (prefix)
      if (messageType === 'system') {
        return { role: 'user', parts: [ { text: `System: ${message.content}` } ] };
      }
      // 3. Normal simple text
      if (typeof message.content === 'string') {
        return { role, parts: [ { text: message.content } ] };
      }
      // 4. Array content (structured parts)
      if (Array.isArray(message.content)) {
        return {
          role,
          parts: message.content.map(part => {
            if (typeof part === 'string') return { text: part };
            if ('text' in part) return { text: part.text };
            if ('functionCall' in part) return { functionCall: part.functionCall };
            if ('functionResponse' in part) return { functionResponse: part.functionResponse };
            // fallback
            return { text: JSON.stringify(part) };
          })
        };
      }
      // 5. Tool/function call via additional_kwargs (used by LangChain for OpenAI compatible code)
      // (Our format supports only single function call per message/part, take the first if multi present)
      if (message.additional_kwargs?.tool_calls || message.additional_kwargs?.function_calls) {
        const arr = message.additional_kwargs.tool_calls || message.additional_kwargs.function_calls;
        if (Array.isArray(arr) && arr.length) {
          const call = arr[0];
          if (call.function) return { role, parts: [ { functionCall: call.function } ] };
          if (call.name && call.arguments) {
            return {
              role,
              parts: [ { functionCall: { name: call.name, args: typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments } } ]
            }
          }
        }
      }
      // fallback: everything else
      return { role, parts: [ { text: JSON.stringify(message.content) } ] };
    });
  }

// ...rest as before
}
