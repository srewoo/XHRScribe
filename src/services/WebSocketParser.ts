import { ParsedWebSocketFrame, WebSocketFrameStats } from '@/types';

export class WebSocketParser {
  private static instance: WebSocketParser;

  private constructor() {}

  static getInstance(): WebSocketParser {
    if (!WebSocketParser.instance) {
      WebSocketParser.instance = new WebSocketParser();
    }
    return WebSocketParser.instance;
  }

  parseFrames(rawFrames: any[]): ParsedWebSocketFrame[] {
    if (!Array.isArray(rawFrames)) return [];

    return rawFrames.map((frame, index) => {
      const data = typeof frame === 'string' ? frame : (frame.data || frame.payload || JSON.stringify(frame));
      const direction: 'sent' | 'received' = frame.direction || (frame.opcode === 1 ? 'sent' : 'received') || (index % 2 === 0 ? 'sent' : 'received');
      const timestamp = frame.timestamp || Date.now();

      let parsedData: any = undefined;
      let dataType: 'json' | 'text' | 'binary' = 'text';
      let eventType: string | undefined;
      let channel: string | undefined;

      // Try JSON parse
      try {
        const parsed = JSON.parse(typeof data === 'string' ? data : JSON.stringify(data));
        parsedData = parsed;
        dataType = 'json';

        // Detect common event type patterns
        eventType = parsed.type || parsed.event || parsed.action || parsed.msg || parsed.method;
        channel = parsed.channel || parsed.room || parsed.topic || parsed.stream;
      } catch {
        // Check for binary-looking data
        if (typeof data === 'string' && /^[0-9a-f]+$/i.test(data.replace(/\s/g, ''))) {
          dataType = 'binary';
        }
      }

      return {
        direction,
        data: typeof data === 'string' ? data : JSON.stringify(data),
        timestamp,
        parsedData,
        dataType,
        size: typeof data === 'string' ? new Blob([data]).size : 0,
        eventType: eventType ? String(eventType) : undefined,
        channel: channel ? String(channel) : undefined,
      };
    });
  }

  computeStats(frames: ParsedWebSocketFrame[]): WebSocketFrameStats {
    const sentFrames = frames.filter(f => f.direction === 'sent').length;
    const receivedFrames = frames.filter(f => f.direction === 'received').length;
    const jsonFrames = frames.filter(f => f.dataType === 'json').length;
    const totalBytes = frames.reduce((sum, f) => sum + f.size, 0);
    const eventTypes = [...new Set(frames.map(f => f.eventType).filter(Boolean))] as string[];
    const channels = [...new Set(frames.map(f => f.channel).filter(Boolean))] as string[];

    const timestamps = frames.map(f => f.timestamp).filter(t => t > 0);
    const durationMs = timestamps.length >= 2
      ? Math.max(...timestamps) - Math.min(...timestamps)
      : 0;

    return {
      totalFrames: frames.length,
      sentFrames,
      receivedFrames,
      jsonFrames,
      totalBytes,
      eventTypes,
      channels,
      durationMs,
    };
  }
}
