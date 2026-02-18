import { EventEmitter } from 'events';
import fetch from 'node-fetch';
import { buildSystemPrompt, SessionInfo } from '../prompts/system.js';
import { LLMSessionLogger } from '../utils/llm-session-logger.js';

/**
 * OpenRouter LLM configuration
 */
interface OpenRouterConfig {
  apiKey: string;
  model?: string;
  fallbackModel?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  preferredProviders?: string[];  // Preferred provider order (e.g., ['Together', 'Fireworks', 'Groq'])
}

/**
 * Message in conversation history
 */
interface Message {
  role: 'system' | 'user' | 'assistant' | 'function';
  content: string;
  name?: string;  // For function messages
}

/**
 * Tool definition (OpenAI function calling format)
 */
interface Tool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * Tool call from LLM
 */
export interface ToolCall {
  name: string;
  arguments: any;
}

/**
 * OpenRouterLLMService handles LLM streaming via OpenRouter API
 */
export class OpenRouterLLMService extends EventEmitter {
  private config: Required<OpenRouterConfig>;
  private messageHistory: Message[] = [];
  private sessionInfo: SessionInfo;
  private currentAbortController: AbortController | null = null;
  private isStreaming: boolean = false;
  private logger: LLMSessionLogger;

  // Tools: mix of action tools (modify state) and read tools (query data)
  private tools: Tool[] = [
    // === ACTION TOOLS (modify simulator state) ===
    {
      name: 'configure_pit_stop',
      description: 'Configures pit stop parameters (fuel, tires, repairs)',
      parameters: {
        type: 'object',
        properties: {
          fuelToAdd: { type: 'number', description: 'Liters of fuel to add' },
          changeTires: { type: 'boolean', description: 'Whether to change tires' },
          tireCompound: { type: 'string', description: 'Tire compound (soft/medium/hard)' },
          repairDamage: { type: 'boolean', description: 'Whether to repair damage' },
        },
        required: [],
      },
    },
    {
      name: 'get_pit_status',
      description: 'Gets current pit stop configuration',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'send_chat_macro',
      description: 'Sends a predefined chat message macro',
      parameters: {
        type: 'object',
        properties: {
          macroNumber: { type: 'number', description: 'Macro number (1-12)' },
        },
        required: ['macroNumber'],
      },
    },
    {
      name: 'request_current_setup',
      description: 'Requests current car setup to be read and displayed',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },

    // === READ TOOLS (query telemetry data) ===
    {
      name: 'get_session_context',
      description: 'Returns complete session data: lap times, standings (all drivers with iRating/SR), gaps, flags. Use when asked about other drivers, iRating, Safety Rating, or full standings table.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'get_vehicle_setup',
      description: 'Returns vehicle setup (suspension, tires, aero, brakes) if available. Use when asked about setup, tire pressures, mechanical configuration.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'get_recent_events',
      description: 'Returns recent race events (position changes, lap times, damage, flags). Use when asked "what happened?" or for recent context.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of events to return (default: 20)' },
        },
        required: [],
      },
    },
    {
      name: 'compare_laps',
      description: 'Compares telemetry between two laps and provides analysis. Use for performance analysis, finding where time is lost. References: "session_best", "last", or lap number.',
      parameters: {
        type: 'object',
        properties: {
          lap1: { type: 'string', description: 'First lap reference (default: "session_best")' },
          lap2: { type: 'string', description: 'Second lap reference (default: "last")' },
        },
        required: [],
      },
    },
  ];

  constructor(config: OpenRouterConfig, sessionInfo: SessionInfo) {
    super();

    this.config = {
      apiKey: config.apiKey,
      model: config.model || 'qwen/qwen3-235b-a22b-2507:nitro',
      fallbackModel: config.fallbackModel || 'openai/gpt-4o-mini',
      maxTokens: config.maxTokens || 250,  // Short radio-style responses
      temperature: config.temperature || 0.7,
      topP: config.topP || 1.0,
      preferredProviders: config.preferredProviders || [],
    };

    this.sessionInfo = sessionInfo;
    this.logger = new LLMSessionLogger(this.config.model);

    // Initialize with system prompt
    this.messageHistory.push({
      role: 'system',
      content: buildSystemPrompt(sessionInfo),
    });
  }

  /**
   * Send a message and stream the response
   */
  public async sendMessage(
    userMessage: string,
    raceStateContext: string,
    isProactive: boolean = false,
    triggerType: 'user' | 'proactive' | 'periodic' = 'user'
  ): Promise<void> {
    if (this.isStreaming) {
      console.warn('[OpenRouterLLM] Already streaming, aborting previous stream');
      this.abort();
    }

    this.isStreaming = true;
    this.currentAbortController = new AbortController();

    // Build user message with state context
    const contextPrefix = isProactive ? '[EVENT]' : '[USER]';
    const fullMessage = `[STATE]
${raceStateContext}

${contextPrefix}
${userMessage}`;

    // Add to history
    this.messageHistory.push({
      role: 'user',
      content: fullMessage,
    });

    // Keep only last 15 messages (to stay within context limits)
    if (this.messageHistory.length > 16) {  // 1 system + 15 conversation
      this.messageHistory = [
        this.messageHistory[0],  // Keep system prompt
        ...this.messageHistory.slice(-15),
      ];
    }

    try {
      const requestStartTime = Date.now();
      console.log(`[OpenRouterLLM] Sending message to ${this.config.model}`);
      console.log(`[OpenRouterLLM] Message history length: ${this.messageHistory.length} messages`);
      console.log(`[OpenRouterLLM] System prompt length: ${this.messageHistory[0]?.content?.length || 0} chars`);
      console.log(`[OpenRouterLLM] User message: "${userMessage}"`);

      // Build request body (use modern 'tools' format instead of deprecated 'functions')
      const requestBody: any = {
        model: this.config.model,
        messages: this.messageHistory,
        tools: this.tools.map(tool => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        top_p: this.config.topP,
        stream: true,
        route: 'fallback',  // Automatic fallback to fallbackModel if primary fails
      };

      // Add provider preferences if specified
      if (this.config.preferredProviders && this.config.preferredProviders.length > 0) {
        requestBody.provider = {
          order: this.config.preferredProviders,
          require_parameters: true,  // Only use providers that support function calling
        };
        console.log(`[OpenRouterLLM] Provider preferences: ${this.config.preferredProviders.join(', ')}`);
      }

      // Log request (snapshot of history BEFORE this message is sent)
      this.logger.logRequest({
        triggerType,
        userMessage,
        raceContext: raceStateContext,
        messageHistory: this.messageHistory.map(m => ({ role: m.role, content: m.content })),
        tools: this.tools,
        model: this.config.model,
        maxTokens: this.config.maxTokens,
        temperature: this.config.temperature,
      });

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'HTTP-Referer': 'https://vicen-racing-engineer.app',
          'X-Title': 'VICEN Racing Engineer',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: this.currentAbortController.signal,
      });

      if (!response.ok) {
        // Try to get error details from response body
        let errorDetails = '';
        try {
          const errorBody = await response.text();
          errorDetails = errorBody ? ` - ${errorBody}` : '';
        } catch {
          // Ignore if can't read body
        }
        throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}${errorDetails}`);
      }

      if (!response.body) {
        throw new Error('No response body from OpenRouter');
      }

      // Parse SSE stream with latency tracking
      await this.parseSSEStream(response.body, requestStartTime, this.logger);

    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('[OpenRouterLLM] Stream aborted');
        this.emit('aborted');
      } else {
        console.error('[OpenRouterLLM] Error:', error);
        this.emit('error', error);
      }
    } finally {
      this.isStreaming = false;
      this.currentAbortController = null;
    }
  }

  /**
   * Parse Server-Sent Events stream
   */
  private async parseSSEStream(stream: NodeJS.ReadableStream, requestStartTime: number, logger: LLMSessionLogger): Promise<void> {
    let buffer = '';
    let accumulatedText = '';
    let toolCall: { name: string; arguments: string } | null = null;
    const streamStartTime = Date.now();
    let ttfb: number | null = null;  // Time To First Byte
    let tokenCount = 0;

    for await (const chunk of stream) {
      if (!this.isStreaming) {
        break;  // Aborted
      }

      // Track TTFB (Time To First Byte)
      if (ttfb === null) {
        ttfb = Date.now() - requestStartTime;
        console.log(`[OpenRouterLLM] ⚡ TTFB: ${ttfb}ms`);
      }

      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';  // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();

          if (data === '[DONE]') {
            // Stream completed - calculate metrics
            const streamDuration = Date.now() - streamStartTime;
            const totalDuration = Date.now() - requestStartTime;

            console.log(`[OpenRouterLLM] ✅ Stream completed`);
            console.log(`[OpenRouterLLM] 📊 Latency metrics:`);
            console.log(`[OpenRouterLLM]    - TTFB: ${ttfb}ms`);
            console.log(`[OpenRouterLLM]    - Stream duration: ${streamDuration}ms`);
            console.log(`[OpenRouterLLM]    - Total duration: ${totalDuration}ms`);
            if (tokenCount > 0) {
              console.log(`[OpenRouterLLM]    - Tokens: ~${tokenCount}`);
              console.log(`[OpenRouterLLM]    - Tokens/sec: ${(tokenCount / (streamDuration / 1000)).toFixed(1)}`);
            }

            if (toolCall) {
              // Tool call completed
              try {
                const args = JSON.parse(toolCall.arguments);
                logger.logResponse({
                  responseText: '',
                  toolCall: { name: toolCall.name, arguments: args },
                  ttfbMs: ttfb,
                  totalDurationMs: totalDuration,
                  estimatedTokens: tokenCount,
                });
                this.emit('functionCall', { name: toolCall.name, arguments: args });
              } catch (error) {
                console.error('[OpenRouterLLM] Failed to parse tool arguments:', error);
              }
            } else {
              // Normal text response completed
              logger.logResponse({
                responseText: accumulatedText,
                toolCall: null,
                ttfbMs: ttfb,
                totalDurationMs: totalDuration,
                estimatedTokens: tokenCount,
              });
              this.messageHistory.push({
                role: 'assistant',
                content: accumulatedText,
              });
              this.emit('done', accumulatedText, totalDuration);
            }
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;

            if (!delta) continue;

            // Handle text content
            if (delta.content) {
              accumulatedText += delta.content;
              tokenCount++;  // Approximate token count (1 chunk ≈ 1 token)
              this.emit('delta', delta.content);
            }

            // Handle tool calls (modern format)
            if (delta.tool_calls && delta.tool_calls.length > 0) {
              const tc = delta.tool_calls[0];
              if (tc.function?.name) {
                toolCall = { name: tc.function.name, arguments: '' };
              }
              if (tc.function?.arguments) {
                toolCall!.arguments += tc.function.arguments;
              }
            }

            // Handle function calls (legacy format - fallback)
            if (delta.function_call) {
              if (delta.function_call.name) {
                toolCall = { name: delta.function_call.name, arguments: '' };
              }
              if (delta.function_call.arguments) {
                toolCall!.arguments += delta.function_call.arguments;
              }
            }

          } catch (error) {
            // Ignore parse errors for incomplete JSON chunks
          }
        }
      }
    }
  }

  /**
   * Add function result to conversation
   */
  public addFunctionResult(functionName: string, result: any): void {
    this.messageHistory.push({
      role: 'function',
      name: functionName,
      content: JSON.stringify(result),
    });
  }

  /**
   * Abort current stream
   */
  public abort(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.isStreaming = false;
      this.currentAbortController = null;
    }
  }

  /**
   * Check if currently streaming
   */
  public getIsStreaming(): boolean {
    return this.isStreaming;
  }

  /**
   * Get message history (for debugging)
   */
  public getMessageHistory(): Message[] {
    return [...this.messageHistory];
  }

  /**
   * Clear message history (reset conversation)
   */
  public clearHistory(): void {
    this.messageHistory = [
      {
        role: 'system',
        content: buildSystemPrompt(this.sessionInfo),
      },
    ];
  }
}
