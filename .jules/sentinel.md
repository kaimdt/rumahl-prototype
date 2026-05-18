## 2024-05-18 - XSS in Markdown Rendering
**Vulnerability:** Markdown rendering in `frontend/src/components/DocsPageNew.tsx` used `marked()` combined with `dangerouslySetInnerHTML` without sanitization.
**Learning:** Even internal documentation pages can be vulnerable to XSS if `dangerouslySetInnerHTML` is used. While `marked()` parses markdown, it does not sanitize raw HTML within the markdown.
**Prevention:** Always use `DOMPurify.sanitize()` (or a similar sanitization library) to wrap output from Markdown parsers before passing it to Reacts `dangerouslySetInnerHTML`.
