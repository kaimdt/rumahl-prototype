/**
 * Lightweight, dependency-free syntax highlighter.
 *
 * Follows the same philosophy as the markdown parser in ./parser.ts:
 * no external highlighting libraries, just a small tokenizer that
 * understands the languages used in the docs & support articles
 * (bash/shell, JSON, JavaScript/TypeScript, SQL, YAML).
 *
 * Output is a flat list of tokens; consumers render them as React
 * text nodes (safe — no dangerouslySetInnerHTML) with theme-aware
 * colors.
 */

export type TokenType =
  | "plain"
  | "comment"
  | "string"
  | "keyword"
  | "number"
  | "variable"
  | "flag"
  | "function"
  | "property"
  | "boolean"
  | "punctuation";

export interface HighlightToken {
  type: TokenType;
  value: string;
}

/* ─────────── Language definitions ─────────── */

interface LangConfig {
  /** Control-flow keywords + common commands. */
  keywords: Set<string>;
  /** Bash-style `$VAR` / `${VAR}`. */
  variables: boolean;
  /** Bash-style `-x` / `--long` flags. */
  flags: boolean;
  /** Identifier directly followed by `(` → function call. */
  functionCalls: boolean;
  /** JSON-style `"key":` → property. */
  jsonKeys: boolean;
  /** Backtick template literals (JS). */
  backticks: boolean;
  /** `true` / `false` / `null` etc. */
  booleans: Set<string>;
  /** Comment start sequences; null end = to end of line. */
  comments: Array<[string, string | null]>;
}

const BASH_KEYWORDS = new Set([
  "if", "then", "else", "elif", "fi", "for", "while", "until", "do", "done",
  "case", "esac", "function", "in", "select", "time", "export", "local",
  "readonly", "declare", "return", "exit", "break", "continue", "source",
  "alias", "unset", "set", "shift", "trap", "eval", "exec", "printf", "echo",
  "cd", "pwd", "ls", "cat", "mkdir", "rm", "rmdir", "cp", "mv", "touch",
  "chmod", "chown", "curl", "wget", "sudo", "apt", "apt-get", "dpkg",
  "docker", "docker-compose", "systemctl", "journalctl", "service", "npm",
  "node", "npx", "yarn", "pnpm", "git", "pip", "pip3", "python", "python3",
  "ssh", "scp", "rsync", "tar", "gzip", "gunzip", "unzip", "zip", "sed",
  "awk", "grep", "egrep", "find", "xargs", "head", "tail", "less", "more",
  "sort", "uniq", "wc", "cut", "paste", "tr", "tee", "kill", "ps", "top",
  "htop", "free", "df", "du", "mount", "umount", "ufw", "iptables", "nano",
  "vim", "vi", "clear", "history", "which", "whereis", "whoami", "id",
  "groups", "env", "nohup", "install", "ln", "readlink", "realpath",
  "basename", "dirname", "pushd", "popd", "test", "true", "false", "pm2",
  "crontab", "sqlite3",
]);

const JS_KEYWORDS = new Set([
  "import", "from", "export", "default", "const", "let", "var", "function",
  "return", "if", "else", "for", "while", "do", "switch", "case", "break",
  "continue", "new", "class", "extends", "super", "this", "typeof",
  "instanceof", "in", "of", "async", "await", "try", "catch", "finally",
  "throw", "yield", "static", "get", "set", "delete", "void",
]);

const SQL_KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "INSERT", "INTO", "VALUES", "UPDATE", "SET",
  "DELETE", "CREATE", "TABLE", "ALTER", "DROP", "INDEX", "PRIMARY", "KEY",
  "FOREIGN", "REFERENCES", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "ON",
  "GROUP", "BY", "ORDER", "HAVING", "LIMIT", "OFFSET", "AND", "OR", "NOT",
  "NULL", "IS", "IN", "LIKE", "BETWEEN", "AS", "DISTINCT", "UNION", "ALL",
  "COUNT", "SUM", "AVG", "MIN", "MAX", "BEGIN", "COMMIT", "ROLLBACK",
]);

const YAML_KEYWORDS = new Set([
  "on", "off", "true", "false", "yes", "no", "null", "version", "includes",
]);

const CONFIGS: Record<string, LangConfig> = {
  bash: {
    keywords: BASH_KEYWORDS,
    variables: true,
    flags: true,
    functionCalls: false,
    jsonKeys: false,
    backticks: false,
    booleans: new Set(["true", "false"]),
    comments: [["#", null]],
  },
  shell: {
    keywords: BASH_KEYWORDS,
    variables: true,
    flags: true,
    functionCalls: false,
    jsonKeys: false,
    backticks: false,
    booleans: new Set(["true", "false"]),
    comments: [["#", null]],
  },
  sh: {
    keywords: BASH_KEYWORDS,
    variables: true,
    flags: true,
    functionCalls: false,
    jsonKeys: false,
    backticks: false,
    booleans: new Set(["true", "false"]),
    comments: [["#", null]],
  },
  json: {
    keywords: new Set(),
    variables: false,
    flags: false,
    functionCalls: false,
    jsonKeys: true,
    backticks: false,
    booleans: new Set(["true", "false", "null"]),
    comments: [],
  },
  javascript: {
    keywords: JS_KEYWORDS,
    variables: false,
    flags: false,
    functionCalls: true,
    jsonKeys: false,
    backticks: true,
    booleans: new Set(["true", "false", "null", "undefined"]),
    comments: [
      ["/*", "*/"],
      ["//", null],
    ],
  },
  js: {
    keywords: JS_KEYWORDS,
    variables: false,
    flags: false,
    functionCalls: true,
    jsonKeys: false,
    backticks: true,
    booleans: new Set(["true", "false", "null", "undefined"]),
    comments: [
      ["/*", "*/"],
      ["//", null],
    ],
  },
  typescript: {
    keywords: new Set([...JS_KEYWORDS, "interface", "type", "enum", "implements", "readonly", "public", "private", "protected", "namespace", "declare", "satisfies", "as", "is"]),
    variables: false,
    flags: false,
    functionCalls: true,
    jsonKeys: false,
    backticks: true,
    booleans: new Set(["true", "false", "null", "undefined"]),
    comments: [
      ["/*", "*/"],
      ["//", null],
    ],
  },
  ts: {
    keywords: new Set([...JS_KEYWORDS, "interface", "type", "enum", "implements", "readonly", "public", "private", "protected", "namespace", "declare", "satisfies", "as", "is"]),
    variables: false,
    flags: false,
    functionCalls: true,
    jsonKeys: false,
    backticks: true,
    booleans: new Set(["true", "false", "null", "undefined"]),
    comments: [
      ["/*", "*/"],
      ["//", null],
    ],
  },
  sql: {
    keywords: SQL_KEYWORDS,
    variables: false,
    flags: false,
    functionCalls: false,
    jsonKeys: false,
    backticks: false,
    booleans: new Set(["NULL"]),
    comments: [["--", null]],
  },
  yaml: {
    keywords: YAML_KEYWORDS,
    variables: false,
    flags: false,
    functionCalls: false,
    jsonKeys: true,
    backticks: false,
    booleans: new Set(["true", "false", "null"]),
    comments: [["#", null]],
  },
  yml: {
    keywords: YAML_KEYWORDS,
    variables: false,
    flags: false,
    functionCalls: false,
    jsonKeys: true,
    backticks: false,
    booleans: new Set(["true", "false", "null"]),
    comments: [["#", null]],
  },
};

/* ─────────── Language detection (fallback for unlabeled blocks) ─────────── */

export function detectLang(code: string): string | undefined {
  const t = code.trim();
  if (!t) return undefined;
  // JSON: starts with `{`/`[` and contains "key": patterns
  if (/^[[{]/.test(t) && /"[^"]+"\s*:/.test(t)) return "json";
  // SQL: typical statement starters
  if (/^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(t)) return "sql";
  // YAML: `key: value` at line starts
  if (/^[\w-]+:\s+\S/.test(t) && !/^https?:/.test(t)) return "yaml";
  // Bash: shebang, shell commands, flags with commands
  if (
    /^#!/.test(t) ||
    /(^|\n)\s*(curl|sudo|apt|apt-get|systemctl|docker|npm|node|npx|git|ssh|pip|python3?|cd|mkdir|rm|cp|mv|ls|cat|grep|tar|wget)\s/.test(t) ||
    /(^|\n)\s*[A-Z_]+=/.test(t)
  ) {
    return "bash";
  }
  // JS/TS: imports, const/let, arrow functions
  if (
    /(^|\n)\s*import\s+.*\s+from\s+["']/.test(t) ||
    /(^|\n)\s*(const|let|var|function|async|await)\s/.test(t) ||
    /=>/.test(t)
  ) {
    return "javascript";
  }
  return undefined;
}

/* ─────────── Tokenizer ─────────── */

const IDENT_START = /[A-Za-z_$]/;
const IDENT_CHAR = /[A-Za-z0-9_$-]/;
const NUMBER_RE = /^\d+(\.\d+)?/;
const PUNCT_CHARS = new Set([
  "(", ")", "{", "}", "[", "]", ",", ";", ":", ".", "=", "+", "-", "*",
  "/", "<", ">", "|", "&", "!", "?", "%", "^", "~", "@", "\\",
]);

function tokenize(code: string, lang: string | undefined): HighlightToken[] {
  const config = lang ? CONFIGS[lang] : undefined;
  if (!config) return [];

  const tokens: HighlightToken[] = [];
  const push = (type: TokenType, value: string) => {
    if (!value) return;
    const last = tokens[tokens.length - 1];
    if (last && last.type === type) {
      last.value += value;
    } else {
      tokens.push({ type, value });
    }
  };

  let i = 0;
  const len = code.length;

  while (i < len) {
    const c = code[i];

    // Whitespace
    if (/\s/.test(c)) {
      let j = i + 1;
      while (j < len && /\s/.test(code[j])) j++;
      push("plain", code.slice(i, j));
      i = j;
      continue;
    }

    // Comments
    let matchedComment = false;
    for (const [start, end] of config.comments) {
      if (code.startsWith(start, i)) {
        let j = i + start.length;
        if (end) {
          const close = code.indexOf(end, j);
          j = close === -1 ? len : close + end.length;
        } else {
          while (j < len && code[j] !== "\n") j++;
        }
        push("comment", code.slice(i, j));
        i = j;
        matchedComment = true;
        break;
      }
    }
    if (matchedComment) continue;

    // Strings ("...", '...', backticks)
    const stringDefs: Array<[string, string]> = [['"', '"'], ["'", "'"]];
    if (config.backticks) stringDefs.push(["`", "`"]);
    let matchedString = false;
    for (const [open, close] of stringDefs) {
      if (c === open) {
        let j = i + 1;
        while (j < len) {
          if (code[j] === "\\" && j + 1 < len) {
            j += 2;
            continue;
          }
          if (code[j] === close) {
            j++;
            break;
          }
          j++;
        }
        const value = code.slice(i, j);
        // JSON style: string directly followed by `:` → property key
        if (config.jsonKeys) {
          let k = j;
          while (k < len && /\s/.test(code[k])) k++;
          if (code[k] === ":") {
            push("property", value);
            i = j;
            matchedString = true;
            break;
          }
        }
        push("string", value);
        i = j;
        matchedString = true;
        break;
      }
    }
    if (matchedString) continue;

    // Bash variables: $NAME, ${NAME}, $(...)
    if (c === "$" && config.variables) {
      let j = i + 1;
      if (code[j] === "{") {
        const close = code.indexOf("}", j);
        j = close === -1 ? len : close + 1;
      } else if (code[j] === "(") {
        const close = code.indexOf(")", j);
        j = close === -1 ? len : close + 1;
      } else if (IDENT_START.test(code[j] ?? "")) {
        j++;
        while (j < len && IDENT_CHAR.test(code[j])) j++;
      } else {
        push("punctuation", "$");
        i++;
        continue;
      }
      push("variable", code.slice(i, j));
      i = j;
      continue;
    }

    // Bash flags: -x, --long
    if (c === "-" && config.flags) {
      let j = i + 1;
      let flagChars = "";
      if (code[j] === "-") {
        j++;
        while (j < len && /[A-Za-z0-9-]/.test(code[j])) {
          flagChars += code[j];
          j++;
        }
        if (flagChars) {
          push("flag", code.slice(i, j));
          i = j;
          continue;
        }
      } else if (IDENT_START.test(code[j] ?? "")) {
        while (j < len && /[A-Za-z0-9-]/.test(code[j])) {
          flagChars += code[j];
          j++;
        }
        push("flag", code.slice(i, j));
        i = j;
        continue;
      }
      // fall through to punctuation
    }

    // Numbers
    if (/\d/.test(c)) {
      const m = code.slice(i).match(NUMBER_RE);
      if (m) {
        push("number", m[0]);
        i += m[0].length;
        continue;
      }
    }

    // Identifiers / keywords
    if (IDENT_START.test(c)) {
      let j = i + 1;
      while (j < len && IDENT_CHAR.test(code[j])) j++;
      const word = code.slice(i, j);
      if (config.keywords.has(word)) {
        push("keyword", word);
      } else if (config.booleans.has(word)) {
        push("boolean", word);
      } else if (config.functionCalls) {
        let k = j;
        while (k < len && /\s/.test(code[k])) k++;
        if (code[k] === "(") {
          push("function", word);
        } else {
          push("plain", word);
        }
      } else {
        push("plain", word);
      }
      i = j;
      continue;
    }

    // Punctuation run
    let j = i;
    while (j < len && PUNCT_CHARS.has(code[j])) {
      const ch = code[j];
      // Don't swallow chars that start other token kinds
      if (ch === '"' || ch === "'" || ch === "`" || ch === "$" || ch === "#") break;
      j++;
    }
    if (j > i) {
      push("punctuation", code.slice(i, j));
      i = j;
      continue;
    }

    // Fallback: single unknown char
    push("plain", c);
    i++;
  }

  return tokens;
}

/** Highlight a code block. Returns [] for unknown languages (render plain). */
export function highlightCode(code: string, lang?: string): HighlightToken[] {
  const resolved = lang && CONFIGS[lang] ? lang : detectLang(code);
  return tokenize(code, resolved);
}
