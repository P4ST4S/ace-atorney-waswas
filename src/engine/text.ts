import { ContentError, type TextColor, type TextToken } from './types.ts';

const NARROW_NBSP = '\u202F';
const NBSP = '\u00A0';

/**
 * French typography for displayed text:
 * - a space before `! ? ;` becomes a narrow no-break space; a missing one is inserted after a word;
 * - a space before `:` becomes a no-break space (a missing one is NOT inserted, so `23:12` stays intact);
 * - spaces inside « » become no-break spaces.
 */
export function frenchTypography(text: string): string {
  return text
    .replace(/[ \u00A0]+([!?;])/g, `${NARROW_NBSP}$1`)
    .replace(/([\p{L}\p{N}»)])([!?]+)/gu, `$1${NARROW_NBSP}$2`)
    .replace(/[ \u202F]+:/g, `${NBSP}:`)
    .replace(/«[ \u202F]*/g, `«${NBSP}`)
    .replace(/[ \u202F]*»/g, `${NBSP}»`);
}

const COLORS: Readonly<Record<string, TextColor>> = { red: 'red', blue: 'blue', green: 'green' };

/**
 * Parses inline markup into tokens, then applies French typography to text tokens (except `{raw}` spans).
 *
 * Tags: {red} {blue} {green} … {/}, {p:ms}, {s:factor}, {shake}, {flash}, {sfx:id}, {raw}…{/raw}.
 * A literal brace is written `{{` or `}}`.
 */
export function parseMarkup(source: string, where = 'text'): TextToken[] {
  const tokens: TextToken[] = [];
  let color: TextColor = 'white';
  let raw = false;
  let buffer = '';

  const flush = (): void => {
    if (buffer.length === 0) return;
    const text = raw ? buffer : frenchTypography(buffer);
    const last = tokens[tokens.length - 1];
    if (last?.t === 'text' && last.color === color) tokens[tokens.length - 1] = { t: 'text', text: last.text + text, color };
    else tokens.push({ t: 'text', text, color });
    buffer = '';
  };

  let i = 0;
  while (i < source.length) {
    const ch = source.charAt(i);
    if ((ch === '{' || ch === '}') && source.charAt(i + 1) === ch) {
      buffer += ch;
      i += 2;
      continue;
    }
    if (ch === '}') throw new ContentError(`${where}: unexpected "}" at ${i} in "${source}"`);
    if (ch !== '{') {
      buffer += ch;
      i += 1;
      continue;
    }
    const end = source.indexOf('}', i);
    if (end < 0) throw new ContentError(`${where}: unclosed "{" at ${i} in "${source}"`);
    const tag = source.slice(i + 1, end);
    i = end + 1;
    if (raw && tag !== '/raw') {
      buffer += `{${tag}}`;
      continue;
    }
    flush();
    const [name = '', arg] = tag.split(':', 2);
    if (name in COLORS) color = COLORS[name] ?? 'white';
    else if (name === '/') color = 'white';
    else if (name === 'raw') raw = true;
    else if (name === '/raw') raw = false;
    else if (name === 'p' && arg !== undefined && /^\d+$/.test(arg)) tokens.push({ t: 'pause', ms: Number(arg) });
    else if (name === 's' && arg !== undefined && Number(arg) > 0) tokens.push({ t: 'speed', factor: Number(arg) });
    else if (name === 'shake' && arg === undefined) tokens.push({ t: 'shake' });
    else if (name === 'flash' && arg === undefined) tokens.push({ t: 'flash' });
    else if (name === 'sfx' && arg !== undefined && arg.length > 0) tokens.push({ t: 'sfx', sound: arg });
    else throw new ContentError(`${where}: unknown tag "{${tag}}" in "${source}"`);
  }
  if (raw) throw new ContentError(`${where}: unclosed {raw} in "${source}"`);
  flush();
  return tokens;
}

/** Plain displayed text of a token list (used by tests and length heuristics). */
export function plainText(tokens: readonly TextToken[]): string {
  return tokens.map((t) => (t.t === 'text' ? t.text : '')).join('');
}
