/**
 * Tests for the file-icon feature: the external registration API
 * (registerFileIcon / matchFileIcon — registry lifecycle and ranking) and
 * the built-in per-extension glyph map (extension normalization, group
 * hits, and the generic VscFile fallback).
 */
import { describe, it, expect } from 'vitest'
import type { ReactElement } from 'react'
import { VscFile, VscFileCode, VscFileMedia, VscJson, VscMarkdown } from 'react-icons/vsc'

// Mock browser globals (SidebarStore.reduce → schedulePersist uses window.setTimeout)
const g = globalThis as Record<string, unknown>
if (g.window === undefined) {
  g.window = {
    clearTimeout: () => {},
    setTimeout: (_fn: () => void) => 0,
    innerWidth: 1024,
  }
}
if (g.localStorage === undefined) {
  g.localStorage = {
    getItem: () => null,
    setItem: () => {},
  }
}

import { createBetterSidebarService, SIDEBAR_FEATURES } from '../src/client/service.ts'
import { createSidebarStore } from '../src/client/state.ts'
import { builtinFileIcon, fallbackFileIcon } from '../src/client/file-icons.tsx'

describe('file icon registration API', () => {
  it('registerFileIcon adds to the registry and dispose removes it', () => {
    const service = createBetterSidebarService(createSidebarStore())
    expect(service.getFileIcons()).toHaveLength(0)
    const dispose = service.registerFileIcon({
      id: 'test:icons',
      exts: ['csv'],
      icon: () => null,
    })
    expect(service.getFileIcons()).toHaveLength(1)
    expect(service.matchFileIcon('/w/a.csv')?.id).toBe('test:icons')
    dispose()
    expect(service.getFileIcons()).toHaveLength(0)
    expect(service.matchFileIcon('/w/a.csv')).toBeUndefined()
  })

  it('registerFileIcon throws on duplicate id', () => {
    const service = createBetterSidebarService(createSidebarStore())
    service.registerFileIcon({ id: 'dup', exts: [], icon: () => null })
    expect(() => service.registerFileIcon({ id: 'dup', exts: [], icon: () => null })).toThrow()
  })

  it('matches by extension (case-insensitive via path normalization)', () => {
    const service = createBetterSidebarService(createSidebarStore())
    service.registerFileIcon({ id: 'csv', exts: ['csv'], icon: () => null })
    expect(service.matchFileIcon('/w/data.csv')?.id).toBe('csv')
    expect(service.matchFileIcon('/w/DATA.CSV')?.id).toBe('csv')
    expect(service.matchFileIcon('/w/a.tsv')).toBeUndefined()
  })

  it('higher priority wins on extension conflict; ties keep registration order', () => {
    const service = createBetterSidebarService(createSidebarStore())
    service.registerFileIcon({ id: 'low', exts: ['csv'], icon: () => null })
    service.registerFileIcon({ id: 'high', exts: ['csv'], priority: 10, icon: () => null })
    service.registerFileIcon({ id: 'tie', exts: ['csv'], icon: () => null })
    expect(service.matchFileIcon('/w/a.csv')?.id).toBe('high')
    const fresh = createBetterSidebarService(createSidebarStore())
    fresh.registerFileIcon({ id: 'first', exts: ['csv'], icon: () => null })
    fresh.registerFileIcon({ id: 'second', exts: ['csv'], icon: () => null })
    expect(fresh.matchFileIcon('/w/a.csv')?.id).toBe('first')
  })

  it('exts: [] is a catch-all at the bottom (specific exts still win)', () => {
    const service = createBetterSidebarService(createSidebarStore())
    service.registerFileIcon({ id: 'all', exts: [], icon: () => null })
    service.registerFileIcon({ id: 'md', exts: ['md'], icon: () => null })
    expect(service.matchFileIcon('/w/README.md')?.id).toBe('md')
    expect(service.matchFileIcon('/w/Makefile')?.id).toBe('all')
  })

  it('the feature is advertised in SIDEBAR_FEATURES', () => {
    expect(SIDEBAR_FEATURES.includes('fileIcons')).toBe(true)
  })
})

describe('built-in glyph map (builtinFileIcon)', () => {
  it('maps representative extensions to their group glyph', () => {
    expect((builtinFileIcon('/w/README.md', 14) as ReactElement).type).toBe(VscMarkdown)
    expect((builtinFileIcon('/w/logo.png', 14) as ReactElement).type).toBe(VscFileMedia)
    expect((builtinFileIcon('/w/logo.SVG', 14) as ReactElement).type).toBe(VscFileMedia)
    expect((builtinFileIcon('/w/pkg.json', 14) as ReactElement).type).toBe(VscJson)
    expect((builtinFileIcon('/w/main.ts', 14) as ReactElement).type).toBe(VscFileCode)
    expect((builtinFileIcon('/w/main.py', 14) as ReactElement).type).toBe(VscFileCode)
  })

  it('falls back to the generic VscFile for unknown extensions and paths without one', () => {
    expect((builtinFileIcon('/w/data.xyzunknown', 14) as ReactElement).type).toBe(VscFile)
    expect((builtinFileIcon('/w/Makefile', 14) as ReactElement).type).toBe(VscFile)
    expect((fallbackFileIcon(14) as ReactElement).type).toBe(VscFile)
  })
})
