import { useMemo, type ReactNode } from 'react'
import { Link } from '@phosphor-icons/react'

interface MessageContentProps {
  content: string
  role: string
}

export function MessageContent({ content, role }: MessageContentProps) {
  // Parse and render rich content
  const renderedContent = useMemo(() => {
    const elements: ReactNode[] = []
    const lines = content.split('\n')

    lines.forEach((line, lineIndex) => {
      // Check for images: ![alt](url)
      const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
      const images = Array.from(line.matchAll(imageRegex))

      if (images.length > 0) {
        images.forEach((match, imgIndex) => {
          const alt = match[1]
          const url = match[2]
          elements.push(
            <div key={`img-${lineIndex}-${imgIndex}`} className="my-2">
              <img
                src={url}
                alt={alt}
                className="max-w-full rounded-lg border border-foreground/10"
                loading="lazy"
              />
            </div>
          )
        })
        return
      }

      // Check for links: [text](url)
      const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g
      const links = Array.from(line.matchAll(linkRegex))

      if (links.length > 0) {
        const parts: (string | ReactNode)[] = []
        let lastIndex = 0

        links.forEach((match, linkIndex) => {
          const text = match[1]
          const url = match[2]
          const matchIndex = match.index!

          // Add text before link
          if (matchIndex > lastIndex) {
            parts.push(line.substring(lastIndex, matchIndex))
          }

          // Add link
          parts.push(
            <a
              key={`link-${lineIndex}-${linkIndex}`}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-accent hover:underline"
            >
              <Link size={12} weight="bold" />
              {text}
            </a>
          )

          lastIndex = matchIndex + match[0].length
        })

        // Add remaining text
        if (lastIndex < line.length) {
          parts.push(line.substring(lastIndex))
        }

        elements.push(
          <p key={`line-${lineIndex}`} className="text-sm leading-relaxed">
            {parts}
          </p>
        )
        return
      }

      // Check for bold: **text**
      const boldRegex = /\*\*([^*]+)\*\*/g
      const bolds = Array.from(line.matchAll(boldRegex))

      if (bolds.length > 0) {
        const parts: (string | ReactNode)[] = []
        let lastIndex = 0

        bolds.forEach((match, boldIndex) => {
          const text = match[1]
          const matchIndex = match.index!

          if (matchIndex > lastIndex) {
            parts.push(line.substring(lastIndex, matchIndex))
          }

          parts.push(<strong key={`bold-${lineIndex}-${boldIndex}`}>{text}</strong>)

          lastIndex = matchIndex + match[0].length
        })

        if (lastIndex < line.length) {
          parts.push(line.substring(lastIndex))
        }

        elements.push(
          <p key={`line-${lineIndex}`} className="text-sm leading-relaxed">
            {parts}
          </p>
        )
        return
      }

      // Check for code blocks: ```language\ncode\n```
      if (line.startsWith('```')) {
        const lang = line.substring(3)
        elements.push(
          <div key={`code-${lineIndex}`} className="my-2 rounded-lg bg-foreground/5 border border-foreground/10 p-3">
            <code className="text-xs font-mono text-foreground/80">{lang || 'code'}</code>
          </div>
        )
        return
      }

      // Check for inline code: `code`
      const codeRegex = /`([^`]+)`/g
      const codes = Array.from(line.matchAll(codeRegex))

      if (codes.length > 0) {
        const parts: (string | ReactNode)[] = []
        let lastIndex = 0

        codes.forEach((match, codeIndex) => {
          const text = match[1]
          const matchIndex = match.index!

          if (matchIndex > lastIndex) {
            parts.push(line.substring(lastIndex, matchIndex))
          }

          parts.push(
            <code
              key={`code-${lineIndex}-${codeIndex}`}
              className="px-1.5 py-0.5 rounded bg-foreground/10 text-foreground font-mono text-xs"
            >
              {text}
            </code>
          )

          lastIndex = matchIndex + match[0].length
        })

        if (lastIndex < line.length) {
          parts.push(line.substring(lastIndex))
        }

        elements.push(
          <p key={`line-${lineIndex}`} className="text-sm leading-relaxed">
            {parts}
          </p>
        )
        return
      }

      // Regular text line
      if (line.trim()) {
        elements.push(
          <p key={`line-${lineIndex}`} className="text-sm leading-relaxed">
            {line}
          </p>
        )
      } else {
        elements.push(<div key={`spacer-${lineIndex}`} className="h-2" />)
      }
    })

    return elements
  }, [content])

  return <div className="space-y-1">{renderedContent}</div>
}
