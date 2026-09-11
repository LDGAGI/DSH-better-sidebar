/**
 * The optional colored file-icon theme: the lazy-chunk loader that turns the
 * `fileIconTheme` pref into a register/dispose of the colored dataset, and
 * the dataset's own registration through the public `registerFileIcon` API.
 *
 * The loader tests drive a fake chunk (no fetch); the dataset tests use the
 * real chunk module against a real service, asserting representative rules
 * from each table (extension / exact file name / directory name).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import { SiNpm, SiReact } from 'react-icons/si'
import { VscFolder, VscFolderOpened } from 'react-icons/vsc'

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
  g.localStorage = { getItem: () => null, setItem: () => {} }
}

import { registerChunkForTests, resetChunks } from '../src/client/chunk-loader.ts'
import { createBetterSidebarService } from '../src/client/service.ts'
import { createSidebarStore } from '../src/client/state.ts'
import {
  createFileIconThemeLoader,
  FILE_ICON_THEME_BUILTIN,
  FILE_ICON_THEME_COLORED,
} from '../src/client/file-icon-theme.ts'
import { registerColoredFileIcons } from '../src/client/chunks/file-icons.tsx'

/** The component type of a rendered icon element (identity of the glyph). */
const glyphOf = (node: ReactNode): unknown => (node as ReactElement).type
/** The inline color of a rendered icon element (undefined when untinted). */
const colorOf = (node: ReactNode): unknown => (node as ReactElement).props.style?.color

/** Flush the queued promise chain (loadChunk → loader's `.then`). */
const settle = async (): Promise<void> => { await new Promise((resolve) => { setTimeout(resolve, 0) }) }

afterEach(() => { resetChunks() })

describe('file-icon theme loader (pref → lazy chunk → registerFileIcon)', () => {
  it('registers the dataset when the colored theme is selected, and disposes on builtin', async () => {
    const service = createBetterSidebarService(createSidebarStore())
    let registrations = 0
    let disposals = 0
    registerChunkForTests('file-icons', async () => ({
      registerColoredFileIcons: (target: typeof service) => {
        expect(target).toBe(service)
        registrations += 1
        return () => { disposals += 1 }
      },
    }))
    const loader = createFileIconThemeLoader(service)
    expect(service.getFileIcons()).toHaveLength(0)
    loader.set(FILE_ICON_THEME_COLORED)
    await settle()
    expect(registrations).toBe(1)
    loader.set(FILE_ICON_THEME_BUILTIN)
    expect(disposals).toBe(1)
    loader.set(FILE_ICON_THEME_COLORED)
    await settle()
    expect(registrations).toBe(2)
    loader.dispose()
    expect(disposals).toBe(2)
  })

  it('treats an unknown pref value as the built-in theme', async () => {
    const service = createBetterSidebarService(createSidebarStore())
    let registrations = 0
    registerChunkForTests('file-icons', async () => ({
      registerColoredFileIcons: () => { registrations += 1; return () => {} },
    }))
    const loader = createFileIconThemeLoader(service)
    loader.set('no-such-theme')
    await settle()
    expect(registrations).toBe(0)
  })

  it('drops a chunk load that lands after the pref moved back to builtin', async () => {
    const service = createBetterSidebarService(createSidebarStore())
    let registrations = 0
    let release: (() => void) | undefined
    registerChunkForTests('file-icons', () => new Promise((resolve) => {
      release = () => resolve({ registerColoredFileIcons: () => { registrations += 1; return () => {} } })
    }))
    const loader = createFileIconThemeLoader(service)
    loader.set(FILE_ICON_THEME_COLORED)
    loader.set(FILE_ICON_THEME_BUILTIN)
    release?.()
    await settle()
    expect(registrations).toBe(0)
  })

  it('does not re-register on a repeated set of the same value', async () => {
    const service = createBetterSidebarService(createSidebarStore())
    let registrations = 0
    registerChunkForTests('file-icons', async () => ({
      registerColoredFileIcons: () => { registrations += 1; return () => {} },
    }))
    const loader = createFileIconThemeLoader(service)
    loader.set(FILE_ICON_THEME_COLORED)
    loader.set(FILE_ICON_THEME_COLORED)
    await settle()
    expect(registrations).toBe(1)
  })

  it('logs and keeps the built-in glyphs when the chunk fails to load', async () => {
    const service = createBetterSidebarService(createSidebarStore())
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      registerChunkForTests('file-icons', async () => { throw new Error('offline') })
      const loader = createFileIconThemeLoader(service)
      loader.set(FILE_ICON_THEME_COLORED)
      await settle()
      expect(errorSpy).toHaveBeenCalled()
      expect(service.getFileIcons()).toHaveLength(0)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('logs and keeps the built-in glyphs when the chunk exports no registrar', async () => {
    const service = createBetterSidebarService(createSidebarStore())
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      registerChunkForTests('file-icons', async () => ({}))
      const loader = createFileIconThemeLoader(service)
      loader.set(FILE_ICON_THEME_COLORED)
      await settle()
      expect(errorSpy).toHaveBeenCalled()
      expect(service.getFileIcons()).toHaveLength(0)
    } finally {
      errorSpy.mockRestore()
    }
  })
})

describe('colored dataset registration (563 rules through registerFileIcon)', () => {
  it('registers the extension, file-name and directory rules and disposes them', () => {
    const service = createBetterSidebarService(createSidebarStore())
    const dispose = registerColoredFileIcons(service)
    expect(service.getFileIcons().length).toBeGreaterThan(100)

    // Extension rule: .tsx → React blue, and it outranks the built-in glyph.
    const tsx = service.fileIcon('/w/App.tsx', 14)
    expect(glyphOf(tsx)).toBe(SiReact)
    expect(colorOf(tsx)).toBe('#61DAFB')

    // Exact file name rule: package.json → npm red (name beats the .json ext).
    const pkg = service.fileIcon('/w/package.json', 14)
    expect(glyphOf(pkg)).toBe(SiNpm)
    expect(colorOf(pkg)).toBe('#CB3837')

    // Directory rule: node_modules is tinted, an unnamed dir keeps the glyph.
    const nodeModules = service.folderIcon('/w/node_modules', false, 14)
    expect(glyphOf(nodeModules)).toBe(VscFolder)
    expect(colorOf(nodeModules)).toBe('#CB3837')
    expect(glyphOf(service.folderIcon('/w/node_modules', true, 14))).toBe(VscFolderOpened)
    expect(glyphOf(service.folderIcon('/w/zzz-unnamed-dir', false, 14))).toBe(VscFolder)
    expect(colorOf(service.folderIcon('/w/zzz-unnamed-dir', false, 14))).toBeUndefined()

    // An extension the dataset does not cover still falls back to the built-in.
    expect(glyphOf(service.fileIcon('/w/data.unknownext', 14))).toBeDefined()

    dispose()
    expect(service.getFileIcons()).toHaveLength(0)
    expect(colorOf(service.fileIcon('/w/App.tsx', 14))).toBeUndefined()
  })
})
