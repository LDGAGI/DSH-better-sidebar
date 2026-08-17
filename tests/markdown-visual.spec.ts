import { describe, expect, it } from 'vitest'
import { supportsVisualMarkdown } from '../src/client/markdown-visual.ts'

describe('supportsVisualMarkdown', () => {
  it('allows the initial writing schema blocks and marks', () => {
    expect(supportsVisualMarkdown([
      '# Heading',
      '',
      'A **bold** and _italic_ paragraph with `code`.',
      '',
      '- one',
      '- two',
      '',
      '> quote',
      '',
      '```ts',
      'const value = 1',
      '```',
    ].join('\n'))).toBe(true)
  })

  it.each([
    ['front matter', '---\ntitle: Draft\n---\nBody'],
    ['task lists', '- [ ] unfinished'],
    ['tables', '| Name | Value |\n| --- | --- |\n| A | B |'],
    ['images', '![alt](./image.png)'],
    ['footnotes', 'Claim[^1]\n\n[^1]: Source'],
    ['raw HTML', '<aside>Note</aside>'],
    ['MDX imports', "import Card from './Card.tsx'"],
    ['directives', ':::note\nText\n:::'],
  ])('keeps %s in source mode', (_name, source) => {
    expect(supportsVisualMarkdown(source)).toBe(false)
  })
})
