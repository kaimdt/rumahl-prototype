import { parseInline, type InlineNode } from "./parser";
import { HttpMethodChip, parseEndpoint } from "@/components/markdown/http-method";

/**
 * Renders inline markdown (bold, italic, code, links, images) from a plain
 * string. Used by article block renderers — works for hand-written support
 * articles as well as markdown docs.
 */
export function InlineText({ text }: { text: string }) {
  const nodes = parseInline(text);
  return (
    <>
      {nodes.map((node, i) => (
        <InlineNodeView key={i} node={node} />
      ))}
    </>
  );
}

function InlineNodeView({ node }: { node: InlineNode }) {
  switch (node.t) {
    case "text":
      return <>{node.v}</>;
    case "bold":
      return <strong className="font-semibold text-foreground">{node.v}</strong>;
    case "italic":
      return <em>{node.v}</em>;
    case "code":
      return <InlineCode text={node.v} />;
    case "link":
      return (
        <a
          href={node.href}
          target={node.href.startsWith("http") ? "_blank" : undefined}
          rel={node.href.startsWith("http") ? "noopener noreferrer" : undefined}
          className="text-primary font-medium underline decoration-primary/30 underline-offset-2 hover:decoration-primary transition-colors"
        >
          {node.v}
        </a>
      );
    case "image":
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={node.src} alt={node.alt} className="inline-block h-4 w-4 rounded-sm align-middle" />;
  }
}

/**
 * Inline code that starts with an HTTP method (GET / POST / PUT …)
 * renders the method(s) as colored badges — used for endpoints in
 * tables and prose, e.g. `POST /api/auth/login`.
 */
function InlineCode({ text }: { text: string }) {
  const parsed = parseEndpoint(text);
  if (parsed) {
    return (
      <code className="inline-flex items-center gap-1 rounded-md bg-muted/50 border border-border/40 px-1.5 py-0.5 font-mono text-[0.85em] align-middle flex-wrap">
        {parsed.methods.map((m) => (
          <HttpMethodChip key={m} method={m} />
        ))}
        {parsed.rest && <span className="text-primary">{parsed.rest}</span>}
      </code>
    );
  }
  return (
    <code className="rounded-md bg-muted/50 border border-border/40 px-1.5 py-0.5 font-mono text-[0.85em] text-primary">
      {text}
    </code>
  );
}
