import { GenerationOptions } from '@/types';

export interface StreamCallbacks {
  onToken?: (token: string) => void;
  onProgress?: (progress: number, stage: string) => void;
  onComplete?: (fullText: string) => void;
  onError?: (error: Error) => void;
}

export class StreamingService {
  static async processStream(
    response: Response,
    callbacks: StreamCallbacks
  ): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        
        // Process SSE (Server-Sent Events) format
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            
            if (data === '[DONE]') {
              callbacks.onComplete?.(fullText);
              return fullText;
            }

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              
              if (content) {
                fullText += content;
                callbacks.onToken?.(content);
                
                // Calculate approximate progress based on text length
                const estimatedProgress = Math.min(95, fullText.length / 50);
                callbacks.onProgress?.(estimatedProgress, 'Generating test code...');
              }
            } catch (e) {
              // Ignore JSON parse errors for non-JSON lines
            }
          }
        }
      }
    } catch (error) {
      callbacks.onError?.(error as Error);
      throw error;
    } finally {
      reader.releaseLock();
    }

    callbacks.onComplete?.(fullText);
    return fullText;
  }

  static async streamOpenAI(
    apiKey: string,
    model: string,
    messages: Array<{ role: string; content: string }>,
    options: GenerationOptions,
    callbacks: StreamCallbacks
  ): Promise<string> {
    try {
      callbacks.onProgress?.(5, 'Connecting to OpenAI...');
      
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.7,
          max_tokens: 16000, // Allow much larger responses
          stream: true,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'OpenAI API error');
      }

      callbacks.onProgress?.(10, 'Processing response...');
      return await this.processStream(response, callbacks);
    } catch (error) {
      callbacks.onError?.(error as Error);
      throw error;
    }
  }

  static async streamClaude(
    apiKey: string,
    model: string,
    messages: Array<{ role: string; content: string }>,
    options: GenerationOptions,
    callbacks: StreamCallbacks
  ): Promise<string> {
    try {
      callbacks.onProgress?.(5, 'Connecting to Claude...');
      
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          messages: messages.filter(m => m.role !== 'system'), // Claude doesn't use system role
          system: messages.find(m => m.role === 'system')?.content,
          max_tokens: 32000, // Allow much larger responses for Claude
          stream: true,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Claude API error');
      }

      callbacks.onProgress?.(10, 'Processing response...');
      return await this.processStreamClaude(response, callbacks);
    } catch (error) {
      callbacks.onError?.(error as Error);
      throw error;
    }
  }

  private static async processStreamClaude(
    response: Response,
    callbacks: StreamCallbacks
  ): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        
        // Process SSE format for Claude
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            
            try {
              const parsed = JSON.parse(data);
              
              if (parsed.type === 'content_block_delta') {
                const content = parsed.delta?.text;
                if (content) {
                  fullText += content;
                  callbacks.onToken?.(content);
                  
                  const estimatedProgress = Math.min(95, fullText.length / 50);
                  callbacks.onProgress?.(estimatedProgress, 'Generating test code...');
                }
              } else if (parsed.type === 'message_stop') {
                callbacks.onComplete?.(fullText);
                return fullText;
              }
            } catch (e) {
              // Ignore JSON parse errors
            }
          }
        }
      }
    } catch (error) {
      callbacks.onError?.(error as Error);
      throw error;
    } finally {
      reader.releaseLock();
    }

    callbacks.onComplete?.(fullText);
    return fullText;
  }

  static simulateStreaming(
    text: string,
    callbacks: StreamCallbacks,
    chunkSize: number = 10
  ): Promise<void> {
    return new Promise((resolve) => {
      let index = 0;
      const totalChunks = Math.ceil(text.length / chunkSize);
      
      const interval = setInterval(() => {
        if (index >= text.length) {
          clearInterval(interval);
          callbacks.onComplete?.(text);
          callbacks.onProgress?.(100, 'Generation complete');
          resolve();
          return;
        }

        const chunk = text.slice(index, index + chunkSize);
        callbacks.onToken?.(chunk);
        
        const progress = Math.floor((index / text.length) * 100);
        callbacks.onProgress?.(progress, 'Generating test code...');
        
        index += chunkSize;
      }, 50); // Simulate streaming speed
    });
  }
}