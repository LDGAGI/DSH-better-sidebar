// @vitest-environment jsdom
import { act } from 'react-dom/test-utils'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WritingEditor } from '../src/client/WritingEditor.tsx'
import { attachLocale } from '../src/client/locales.ts'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

class FakeLocale {
  constructor(readonly active: string) {}
  getSnapshot(): { active: string } { return { active: this.active } }
  subscribe(_fn: () => void): () => void { return () => {} }
  register(_ns: string, _locale: string, _dict: Record<string, string>): () => void { return () => {} }
}

describe('WritingEditor', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    host.remove()
    attachLocale(undefined)
  })

  it('hydrates Markdown into a native editable document with unified controls', async () => {
    attachLocale(new FakeLocale('en'))
    const onChange = vi.fn()
    await act(async () => {
      root.render(<WritingEditor value={'# Draft\n\nA **bold** paragraph.'} onChange={onChange} onSave={() => {}} />)
    })

    const editor = host.querySelector<HTMLElement>('[contenteditable="true"]')
    expect(editor).not.toBeNull()
    expect(editor?.querySelector('h1')?.textContent).toBe('Draft')
    expect(editor?.querySelector('strong')?.textContent).toBe('bold')
    expect(host.querySelector('[role="toolbar"]')?.getAttribute('aria-label')).toBe('Writing toolbar')
    expect(host.querySelector('button[aria-label="Bold"]')).not.toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('routes Cmd/Ctrl+S through the shared document save action', async () => {
    const onSave = vi.fn()
    await act(async () => {
      root.render(<WritingEditor value="Draft" onChange={() => {}} onSave={onSave} />)
    })
    const editor = host.querySelector<HTMLElement>('[contenteditable="true"]')
    expect(editor).not.toBeNull()

    await act(async () => {
      editor?.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }))
    })
    expect(onSave).toHaveBeenCalledTimes(1)
  })
})
