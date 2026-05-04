## 2025-05-04 - [Fix XSS Vulnerability in Markdown Renderer]
**Vulnerability:** Used `dangerouslySetInnerHTML` to render un-sanitized markdown output directly from `marked()`.
**Learning:** React elements utilizing `dangerouslySetInnerHTML` should never be trusted with user-supplied or external content directly. `marked()` generates HTML, but it explicitly doesn't sanitize it by default.
**Prevention:** Always wrap HTML strings with a sanitizer like `DOMPurify.sanitize()` before passing them into `dangerouslySetInnerHTML`.
