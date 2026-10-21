'use client'

import { lazy, memo, Suspense, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Coloration syntaxique chargée à la demande (premier bloc de code affiché) :
// le code s'affiche aussitôt en texte brut, puis coloré dès que le module arrive.
const CodeHighlighter = lazy(() => import('./CodeHighlighter'))

function PlainCode({ value }: { value: string }) {
  return (
    <pre className="m-0 whitespace-pre-wrap break-words p-4 font-mono text-[0.8rem] leading-relaxed text-zinc-200">
      <code>{value}</code>
    </pre>
  )
}

function CodeBlock({ language, value }: { language: string; value: string }) {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* presse-papiers indisponible */
    }
  }
  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border border-border bg-zinc-950">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="font-mono text-xs text-muted-foreground">{language || 'code'}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={onCopy}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-muted-foreground" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copié' : 'Copier'}
        </Button>
      </div>
      <Suspense fallback={<PlainCode value={value} />}>
        <CodeHighlighter language={language} value={value} />
      </Suspense>
    </div>
  )
}

export const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <div className="text-sm leading-relaxed text-foreground [&_a]:text-muted-foreground [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-primary/50 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-accent [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.8em] [&_code]:text-muted-foreground [&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-lg [&_h1]:font-bold [&_h1]:text-foreground [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-foreground [&_h3]:mb-1.5 [&_h3]:mt-3 [&_h3]:font-semibold [&_h3]:text-foreground [&_hr]:my-4 [&_hr]:border-border [&_li]:mb-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_p]:mb-2 [&_p]:last:mb-0 [&_strong]:text-foreground [&_table]:my-3 [&_table]:w-full [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
      <ReactMarkdown
        components={{
          code(props) {
            const { className, children } = props
            const match = /language-(\w+)/.exec(className || '')
            const text = String(children).replace(/\n$/, '')
            const isBlock = match || text.includes('\n')
            if (isBlock) {
              return <CodeBlock language={match?.[1] ?? ''} value={text} />
            }
            return <code className={className}>{children}</code>
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
