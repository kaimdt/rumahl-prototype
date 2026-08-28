"use client";

import CodeMirror from "@uiw/react-codemirror";
import { css } from "@codemirror/lang-css";
import { Braces, WandSparkles } from "lucide-react";

function formatCss(source: string): string {
  let indent = 0;
  let output = "";
  let token = "";
  let quote = "";
  let comment = false;
  const flush = () => {
    const value = token.trim();
    if (value) output += `${"  ".repeat(indent)}${value}`;
    token = "";
  };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1] ?? "";
    if (comment) {
      token += char;
      if (char === "*" && next === "/") { token += next; index += 1; comment = false; }
      continue;
    }
    if (!quote && char === "/" && next === "*") { comment = true; token += "/*"; index += 1; continue; }
    if (char === '"' || char === "'") {
      if (quote === char && source[index - 1] !== "\\") quote = "";
      else if (!quote) quote = char;
      token += char;
      continue;
    }
    if (quote) { token += char; continue; }
    if (char === "{") { flush(); output += " {\n"; indent += 1; }
    else if (char === ";") { token += ";"; flush(); output += "\n"; }
    else if (char === "}") { flush(); indent = Math.max(0, indent - 1); output += `${output.endsWith("\n") ? "" : "\n"}${"  ".repeat(indent)}}\n`; }
    else if (!/\s/.test(char) || (token && !token.endsWith(" "))) token += char;
  }
  flush();
  return output.trim();
}

export function CssEditor({ value, onChange, label, formatLabel }: { value: string; onChange: (value: string) => void; label: string; formatLabel: string }) {
  return <section className="overflow-hidden rounded-xl border border-border/50 bg-[#0b1020]">
    <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
      <span className="inline-flex items-center gap-2 text-xs font-bold text-slate-300"><Braces className="h-4 w-4 text-cyan-300" />{label}</span>
      <button type="button" onClick={() => onChange(formatCss(value))} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:bg-white/5"><WandSparkles className="h-3.5 w-3.5" />{formatLabel}</button>
    </div>
    <CodeMirror
      value={value}
      height="320px"
      theme="dark"
      extensions={[css()]}
      onChange={onChange}
      basicSetup={{ lineNumbers: true, foldGutter: true, bracketMatching: true, autocompletion: true, highlightActiveLine: true, indentOnInput: true }}
      className="text-xs"
    />
  </section>;
}
