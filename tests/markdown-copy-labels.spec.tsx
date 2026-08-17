/**
 * Markdown writing-mode locale contract. Tiptap mounts after hydration, but
 * the surrounding Writing/Source controls must follow the DSH locale on the
 * initial render and never fall back to hardcoded copy.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import './browser-globals.ts'
import { TextEditor } from '../src/client/TextEditor.tsx'
import { createSidebarStore } from '../src/client/state.ts'
import { attachLocale } from '../src/client/locales.ts'
import type { FileViewerProps } from '../src/client/service.ts'

class FakeLocale {
  active: string = 'zh'
  getSnapshot(): { active: string } { return { active: this.active } }
  subscribe(_fn: () => void): () => void { return () => {} }
  register(_ns: string, _locale: string, _dict: Record<string, string>): () => void { return () => {} }
}

const CTX = {} as Parameters<typeof TextEditor>[0]['ctx']

function viewerProps(overrides: Partial<FileViewerProps> = {}): FileViewerProps {
  return {
    ctx: CTX,
    store: createSidebarStore(),
    scope: { sessionId: 's1', cwd: '/p' },
    path: '/p/a/README.md',
    title: 'README.md',
    viewerId: 'markdown',
    content: '# Draft\n\nA paragraph.',
    ...overrides,
  }
}

afterEach(() => { attachLocale(undefined) })

describe('Markdown writing-mode labels', () => {
  it('renders the Chinese Writing and Source labels', () => {
    const locale = new FakeLocale()
    locale.active = 'zh'
    attachLocale(locale)
    const html = renderToString(createElement(TextEditor, viewerProps()))
    expect(html).toContain('写作')
    expect(html).toContain('源码')
    expect(html).not.toContain('Writing')
  })

  it('follows the attached locale service for English', () => {
    const locale = new FakeLocale()
    locale.active = 'en'
    attachLocale(locale)
    const html = renderToString(createElement(TextEditor, viewerProps()))
    expect(html).toContain('Writing')
    expect(html).toContain('Source')
    expect(html).not.toContain('写作')
  })

  it('keeps unsupported Markdown in source mode with an explicit reason', () => {
    const locale = new FakeLocale()
    locale.active = 'en'
    attachLocale(locale)
    const html = renderToString(createElement(TextEditor, viewerProps({
      content: '| A | B |\n| --- | --- |\n| 1 | 2 |',
    })))
    expect(html).not.toContain('>Writing<')
    expect(html).toContain('Source mode preserves it unchanged')
  })
})
