export const YT_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

export function extractJsonFromHtml(html: string, varName: string): any {
  const patterns = [
    `var\\s+${varName}\\s*=\\s*`,
    `${varName}\\s*=\\s*`,
  ];

  let startIdx = -1;
  for (const p of patterns) {
    const m = new RegExp(p).exec(html);
    if (m) {
      startIdx = m.index + m[0].length;
      break;
    }
  }
  if (startIdx === -1) return null;

  let depth = 0;
  let inStr = false;
  let esc = false;
  let begin = -1;

  for (let i = startIdx; i < html.length; i++) {
    const ch = html[i];
    if (esc) { esc = false; continue; }
    if (inStr) {
      if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') {
      if (depth === 0) begin = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && begin !== -1) {
        const raw = html.substring(begin, i + 1);
        const cleaned = raw.replace(/\\x([0-9a-fA-F]{2})/g, '\\u00$1');
        return JSON.parse(cleaned);
      }
    }
  }
  return null;
}
