/**
 * Built-in per-extension file glyphs for the file tree (feature: file icons).
 *
 * All glyphs are VSCodicons consumed as `currentColor` monochrome — the same
 * skin contract as every other icon this plugin draws (visual values ride the
 * `--dsw-alias-*` tokens, never hardcoded colors). External plugins that want
 * colorful icons register their own `FileIconDescriptor`s through
 * `ctx.betterSidebar.registerFileIcon` (they own their colors); this map is
 * only the fallback nobody claimed.
 */
import type { ReactNode } from 'react'
import {
  VscDatabase, VscFile, VscFileCode, VscFileMedia, VscFilePdf, VscFileZip,
  VscJson, VscLock, VscMarkdown, VscSettings,
} from 'react-icons/vsc'

/** The generic file glyph — the fallback for every unclaimed extension. */
export function fallbackFileIcon(size: number): ReactNode {
  return <VscFile size={size} />
}

/** One glyph shared by a group of extensions. */
type GlyphGroup = [readonly string[], (size: number) => ReactNode]

/**
 * Extension → glyph groups, first match wins. Extensions are lowercase
 * without the leading dot, matched case-insensitively by the caller's
 * normalization. Groups are ordered specific-first; the trailing catch-all
 * lives in `builtinFileIcon`, not here.
 */
const GROUPS: readonly GlyphGroup[] = [
  [['md', 'markdown', 'mdx'], (size) => <VscMarkdown size={size} />],
  [['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'tiff'], (size) => <VscFileMedia size={size} />],
  [['pdf'], (size) => <VscFilePdf size={size} />],
  [['json', 'jsonc', 'json5'], (size) => <VscJson size={size} />],
  [['html', 'htm', 'xhtml', 'xml', 'jsx', 'tsx'], (size) => <VscFileCode size={size} />],
  [['css', 'scss', 'sass', 'less', 'styl'], (size) => <VscFileCode size={size} />],
  [['js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'py', 'rs', 'go', 'java', 'kt', 'kts', 'swift', 'rb', 'php', 'c', 'h', 'cpp', 'hpp', 'cs', 'm', 'mm', 'scala', 'sh', 'bash', 'zsh', 'fish', 'lua', 'pl', 'r', 'jl', 'dart', 'ex', 'exs', 'erl', 'hs', 'clj', 'cljs', 'vb', 'fs'], (size) => <VscFileCode size={size} />],
  [['yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'properties', 'editorconfig'], (size) => <VscSettings size={size} />],
  [['sql', 'db', 'sqlite', 'sqlite3'], (size) => <VscDatabase size={size} />],
  [['lock'], (size) => <VscLock size={size} />],
  [['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar'], (size) => <VscFileZip size={size} />],
]

const LOOKUP: ReadonlyMap<string, (size: number) => ReactNode> = new Map(
  GROUPS.flatMap(([exts, glyph]) => exts.map((ext) => [ext, glyph] as const)),
)

/**
 * The built-in glyph for a path: its extension's group glyph, or the generic
 * `VscFile` when nothing claims it. Pure and synchronous — the file tree row
 * calls this on every render, so it stays a Map lookup.
 */
export function builtinFileIcon(path: string, size: number): ReactNode {
  const glyph = LOOKUP.get(extOfPath(path))
  return glyph === undefined ? fallbackFileIcon(size) : glyph(size)
}

/** The lowercase extension without leading dot ('' when none). */
function extOfPath(path: string): string {
  const at = path.lastIndexOf('.')
  if (at === -1) return ''
  const base = path.slice(at + 1).toLowerCase()
  return base.includes('/') || base.includes('\\') ? '' : base
}
