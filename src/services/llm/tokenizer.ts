// Lazy wrapper around gpt-tokenizer. The o200k_base BPE ranks are ~2.2 MB; if
// the providers import them eagerly, that weight lands in the popup bundle even
// though tokenization only happens during generation. Loading the module via a
// dynamic import lets webpack split it into an on-demand chunk, keeping the
// popup's initial load small. Until the chunk has loaded, countTokens falls
// back to a ~4-chars/token approximation (good enough for the pre-flight size
// guard and cost preview); call preloadEncoder() before a generation run to get
// exact counts.

let encoder: ((text: string) => number[]) | null = null;
let loading: Promise<void> | null = null;

export function preloadEncoder(): Promise<void> {
  if (encoder) return Promise.resolve();
  if (!loading) {
    loading = import('gpt-tokenizer')
      .then(mod => { encoder = mod.encode; })
      .catch(() => { /* keep the approximation fallback */ });
  }
  return loading;
}

export function countTokens(text: string): number {
  if (encoder) {
    try {
      return encoder(text).length;
    } catch {
      // fall through to approximation
    }
  }
  return Math.ceil(text.length / 4);
}
