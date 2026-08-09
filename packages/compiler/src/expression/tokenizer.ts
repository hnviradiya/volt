/** Tokenizer for the template expression language. */

export type TokenType =
  | 'num'
  | 'str'
  | 'template'
  | 'ident'
  | 'keyword'
  | 'punct'
  | 'regex'
  | 'eof';

export interface TemplatePart {
  quasis: string[];
  expressions: string[];
}

export interface Token {
  type: TokenType;
  value: string;
  start: number;
  end: number;
  /** Cooked value for strings; parsed parts for template literals. */
  parsed?: string | TemplatePart;
}

const KEYWORDS = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'typeof',
  'void',
  'in',
  'instanceof',
  'new',
  'delete',
  'of',
]);

// Longest-first so `>>>=` wins over `>>>` wins over `>>`.
const PUNCTUATORS = [
  '>>>=',
  '...',
  '===',
  '!==',
  '**=',
  '<<=',
  '>>=',
  '>>>',
  '&&=',
  '||=',
  '??=',
  '?.',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '??',
  '**',
  '++',
  '--',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '<<',
  '>>',
  '=>',
  '{',
  '}',
  '(',
  ')',
  '[',
  ']',
  ';',
  ',',
  '<',
  '>',
  '+',
  '-',
  '*',
  '/',
  '%',
  '&',
  '|',
  '^',
  '!',
  '~',
  '?',
  ':',
  '=',
  '.',
];

export class ExpressionSyntaxError extends Error {
  constructor(
    message: string,
    public readonly source: string,
    public readonly index: number,
  ) {
    super(`[volt:expression] ${message} in \`${source}\``);
    this.name = 'ExpressionSyntaxError';
  }
}

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  const fail = (msg: string): never => {
    throw new ExpressionSyntaxError(msg, source, i);
  };

  const lastMeaningful = (): Token | undefined => tokens[tokens.length - 1];

  while (i < source.length) {
    const ch = source[i]!;

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Comments are legal but carry no meaning in an expression.
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end === -1) fail('Unterminated block comment');
      i = end + 2;
      continue;
    }

    const start = i;

    // Numbers
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      if (ch === '0' && /[xXbBoO]/.test(source[i + 1] ?? '')) {
        i += 2;
        while (i < source.length && /[0-9a-fA-F_]/.test(source[i]!)) i++;
      } else {
        while (i < source.length && /[0-9_]/.test(source[i]!)) i++;
        if (source[i] === '.') {
          i++;
          while (i < source.length && /[0-9_]/.test(source[i]!)) i++;
        }
        if (/[eE]/.test(source[i] ?? '')) {
          i++;
          if (/[+-]/.test(source[i] ?? '')) i++;
          while (i < source.length && /[0-9]/.test(source[i]!)) i++;
        }
      }
      if (source[i] === 'n') i++; // BigInt
      tokens.push({ type: 'num', value: source.slice(start, i), start, end: i });
      continue;
    }

    // Strings
    if (ch === '"' || ch === "'") {
      i++;
      let cooked = '';
      while (i < source.length && source[i] !== ch) {
        if (source[i] === '\\') {
          cooked += unescape(source, i);
          i += escapeLength(source, i);
        } else {
          cooked += source[i];
          i++;
        }
      }
      if (i >= source.length) fail('Unterminated string literal');
      i++;
      tokens.push({ type: 'str', value: source.slice(start, i), start, end: i, parsed: cooked });
      continue;
    }

    // Template literals — captured whole, with `${}` bodies kept as raw source
    // for the parser to recurse into.
    if (ch === '`') {
      const part: TemplatePart = { quasis: [], expressions: [] };
      i++;
      let quasi = '';
      while (i < source.length && source[i] !== '`') {
        if (source[i] === '\\') {
          quasi += unescape(source, i);
          i += escapeLength(source, i);
          continue;
        }
        if (source[i] === '$' && source[i + 1] === '{') {
          part.quasis.push(quasi);
          quasi = '';
          i += 2;
          const exprStart = i;
          let depth = 1;
          while (i < source.length && depth > 0) {
            const c = source[i]!;
            if (c === '{') depth++;
            else if (c === '}') depth--;
            else if (c === '"' || c === "'" || c === '`') {
              const quote = c;
              i++;
              while (i < source.length && source[i] !== quote) {
                if (source[i] === '\\') i++;
                i++;
              }
            }
            if (depth > 0) i++;
          }
          if (depth !== 0) fail('Unterminated `${}` in template literal');
          part.expressions.push(source.slice(exprStart, i));
          i++; // closing }
          continue;
        }
        quasi += source[i];
        i++;
      }
      if (i >= source.length) fail('Unterminated template literal');
      part.quasis.push(quasi);
      i++;
      tokens.push({ type: 'template', value: source.slice(start, i), start, end: i, parsed: part });
      continue;
    }

    // Identifiers and keywords
    if (/[A-Za-z_$]/.test(ch)) {
      while (i < source.length && /[A-Za-z0-9_$]/.test(source[i]!)) i++;
      const value = source.slice(start, i);
      tokens.push({ type: KEYWORDS.has(value) ? 'keyword' : 'ident', value, start, end: i });
      continue;
    }

    // Regex vs. division: a `/` is a regex only where a value cannot precede it.
    if (ch === '/') {
      const prev = lastMeaningful();
      const divisionPossible =
        prev !== undefined &&
        ((prev.type === 'ident' && !KEYWORDS.has(prev.value)) ||
          prev.type === 'num' ||
          prev.type === 'str' ||
          prev.type === 'template' ||
          prev.type === 'regex' ||
          (prev.type === 'punct' && [')', ']', '}'].includes(prev.value)) ||
          (prev.type === 'keyword' && ['true', 'false', 'null', 'undefined'].includes(prev.value)));

      if (!divisionPossible) {
        i++;
        let inClass = false;
        while (i < source.length) {
          const c = source[i]!;
          if (c === '\\') {
            i += 2;
            continue;
          }
          if (c === '[') inClass = true;
          else if (c === ']') inClass = false;
          else if (c === '/' && !inClass) break;
          else if (c === '\n') fail('Unterminated regular expression');
          i++;
        }
        if (i >= source.length) fail('Unterminated regular expression');
        i++;
        while (i < source.length && /[dgimsuvy]/.test(source[i]!)) i++;
        tokens.push({ type: 'regex', value: source.slice(start, i), start, end: i });
        continue;
      }
    }

    // Punctuators
    const punct = PUNCTUATORS.find((p) => source.startsWith(p, i));
    if (punct) {
      // `?.5` is a conditional followed by a number, not optional chaining.
      if (punct === '?.' && /[0-9]/.test(source[i + 2] ?? '')) {
        i += 1;
        tokens.push({ type: 'punct', value: '?', start, end: i });
        continue;
      }
      i += punct.length;
      tokens.push({ type: 'punct', value: punct, start, end: i });
      continue;
    }

    fail(`Unexpected character \`${ch}\``);
  }

  tokens.push({ type: 'eof', value: '', start: i, end: i });
  return tokens;
}

const ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  b: '\b',
  f: '\f',
  v: '\v',
  '0': '\0',
};

function escapeLength(source: string, i: number): number {
  const next = source[i + 1];
  if (next === 'u') {
    if (source[i + 2] === '{') {
      const close = source.indexOf('}', i + 3);
      return close === -1 ? 2 : close - i + 1;
    }
    return 6;
  }
  if (next === 'x') return 4;
  return 2;
}

function unescape(source: string, i: number): string {
  const next = source[i + 1];
  if (next === undefined) return '\\';
  if (next === 'u') {
    if (source[i + 2] === '{') {
      const close = source.indexOf('}', i + 3);
      if (close !== -1) {
        return String.fromCodePoint(parseInt(source.slice(i + 3, close), 16));
      }
    }
    return String.fromCharCode(parseInt(source.slice(i + 2, i + 6), 16));
  }
  if (next === 'x') return String.fromCharCode(parseInt(source.slice(i + 2, i + 4), 16));
  return ESCAPES[next] ?? next;
}
