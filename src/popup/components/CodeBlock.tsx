import React, { useMemo } from 'react';
import { Paper } from '@mui/material';
import { useTheme } from '@mui/material/styles';

/**
 * Minimal dependency-free syntax highlighter for generated test code.
 *
 * The CSP forbids loading a CDN highlighter, and bundling a full one is heavy,
 * so this does a lightweight JS/TS tokenisation. SECURITY: the code is
 * LLM-generated (untrusted), so every character — both token text and the gaps
 * between tokens — is HTML-escaped before it is placed in the markup. Tokens
 * are matched against the RAW string and escaped individually, so no unescaped
 * input can ever reach the DOM. (plan.md 6.3)
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const KEYWORDS =
  'const|let|var|function|return|if|else|for|while|do|await|async|import|from|export|default|new|class|extends|super|try|catch|finally|throw|typeof|instanceof|null|undefined|true|false|this|void|yield|switch|case|break|continue|=>';

const TOKEN_RE = new RegExp(
  '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)' + // 1: comments
    "|('(?:\\\\.|[^'\\\\])*'|\"(?:\\\\.|[^\"\\\\])*\"|`(?:\\\\.|[^`\\\\])*`)" + // 2: strings
    '|\\b(' + KEYWORDS + ')\\b' + // 3: keywords
    '|\\b(\\d+\\.?\\d*)\\b', // 4: numbers
  'g'
);

function highlight(code: string, colors: { comment: string; string: string; keyword: string; number: string }): string {
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(code)) !== null) {
    out += escapeHtml(code.slice(last, m.index));
    const text = escapeHtml(m[0]);
    const color = m[1] ? colors.comment : m[2] ? colors.string : m[3] ? colors.keyword : colors.number;
    out += `<span style="color:${color}">${text}</span>`;
    last = m.index + m[0].length;
  }
  out += escapeHtml(code.slice(last));
  return out;
}

export function CodeBlock({ code, maxHeight = 300 }: { code: string; maxHeight?: number }) {
  const theme = useTheme();
  const colors = {
    comment: theme.palette.text.secondary,
    string: theme.palette.success.main,
    keyword: theme.palette.primary.main,
    number: theme.palette.info.main,
  };
  const html = useMemo(() => highlight(code, colors), [code, colors.comment, colors.string, colors.keyword, colors.number]);

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1,
        bgcolor: theme.palette.mode === 'dark' ? 'background.default' : 'grey.50',
        maxHeight,
        overflow: 'auto',
      }}
    >
      <pre style={{ margin: 0, fontSize: 11, fontFamily: 'monospace', whiteSpace: 'pre' }}>
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </Paper>
  );
}
