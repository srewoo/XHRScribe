import { Logger } from '@/services/logging/Logger';

export interface CorrectionPattern {
  original: string;
  corrected: string;
  context: string; // framework name
  timestamp: number;
  frequency: number;
}

const MAX_PATTERNS = 50;
const STORAGE_KEY = '_correction_patterns';

export class CorrectionTracker {
  private static instance: CorrectionTracker;

  private constructor() {}

  static getInstance(): CorrectionTracker {
    if (!CorrectionTracker.instance) {
      CorrectionTracker.instance = new CorrectionTracker();
    }
    return CorrectionTracker.instance;
  }

  async recordCorrection(originalCode: string, editedCode: string, framework: string): Promise<void> {
    const diffs = this.computeLineDiffs(originalCode, editedCode);
    if (diffs.length === 0) return;

    const patterns = await this.getPatterns();

    for (const diff of diffs) {
      const existing = patterns.find(
        p => p.original === diff.original && p.corrected === diff.corrected && p.context === framework
      );
      if (existing) {
        existing.frequency++;
        existing.timestamp = Date.now();
      } else {
        patterns.push({
          original: diff.original,
          corrected: diff.corrected,
          context: framework,
          timestamp: Date.now(),
          frequency: 1,
        });
      }
    }

    // Keep top patterns by frequency, capped at MAX_PATTERNS
    patterns.sort((a, b) => b.frequency - a.frequency);
    const trimmed = patterns.slice(0, MAX_PATTERNS);

    await chrome.storage.local.set({ [STORAGE_KEY]: trimmed });
    Logger.getInstance().info(`Recorded ${diffs.length} correction patterns`, null, 'CorrectionTracker');
  }

  async getTopPatterns(limit = 3): Promise<CorrectionPattern[]> {
    const patterns = await this.getPatterns();
    return patterns.slice(0, limit);
  }

  buildFewShotExamples(patterns: CorrectionPattern[]): string {
    if (patterns.length === 0) return '';

    const examples = patterns.map((p, i) =>
      `Example ${i + 1} (seen ${p.frequency}x):\nBEFORE:\n${p.original}\nAFTER:\n${p.corrected}`
    ).join('\n\n');

    return `\n\nLEARNED CORRECTIONS (apply these patterns):\n${examples}\n`;
  }

  private computeLineDiffs(original: string, edited: string): Array<{ original: string; corrected: string }> {
    const origLines = original.split('\n');
    const editLines = edited.split('\n');
    const diffs: Array<{ original: string; corrected: string }> = [];

    // Simple line-by-line diff — find changed lines
    const maxLen = Math.max(origLines.length, editLines.length);
    for (let i = 0; i < maxLen; i++) {
      const origLine = (origLines[i] || '').trim();
      const editLine = (editLines[i] || '').trim();

      if (origLine !== editLine && origLine.length > 5 && editLine.length > 5) {
        diffs.push({ original: origLine, corrected: editLine });
      }
    }

    // Limit to most meaningful diffs (first 10)
    return diffs.slice(0, 10);
  }

  private async getPatterns(): Promise<CorrectionPattern[]> {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return result[STORAGE_KEY] || [];
  }
}
