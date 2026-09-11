/**
 * The optional colored file-icon theme (pref `fileIconTheme`).
 *
 * `'builtin'` (the default) is the monochrome glyph map the tree already
 * uses — nothing to do. `'colored'` fetches the lazy `file-icons` chunk
 * (~160 brand glyphs + 563 rules) and registers it through the public
 * `registerFileIcon` API; switching back disposes those registrations. The
 * chunk is only fetched when the user picks the theme, so the startup bundle
 * never carries icon data it may not render.
 *
 * The loader is generation-guarded: a fast toggle (or an unload) while the
 * chunk is still in flight must not register the stale dataset.
 */
import { loadChunk } from './chunk-loader.ts'
import type { BetterSidebarService } from './service.ts'

/** The pref value selecting the built-in monochrome glyphs (default). */
export const FILE_ICON_THEME_BUILTIN = 'builtin'
/** The pref value selecting the optional colored brand-icon dataset. */
export const FILE_ICON_THEME_COLORED = 'colored'

/** A registrar exported by the lazy `file-icons` chunk. */
type ColoredRegistrar = (service: BetterSidebarService) => () => void

export interface FileIconThemeLoader {
  /** Apply a pref value (unknown values behave as the built-in theme). */
  set(theme: string): void
  /** Drop any registration and stop reacting to in-flight chunk loads. */
  dispose(): void
}

/**
 * Bind `service` to the `fileIconTheme` pref. Call `set` on activation and on
 * every prefs change; call `dispose` when the plugin unloads.
 */
export function createFileIconThemeLoader(service: BetterSidebarService): FileIconThemeLoader {
  /** Disposer of the currently registered colored dataset, if any. */
  let unregister: (() => void) | undefined
  /** Bumped on every set/dispose: a load that lands on a stale generation is dropped. */
  let generation = 0
  /** The theme the pref currently asks for (repeated set() calls are no-ops). */
  let current: string | undefined

  const dropRegistrations = (): void => {
    const dispose = unregister
    unregister = undefined
    if (dispose !== undefined) dispose()
  }

  const set = (theme: string): void => {
    if (theme === current) return
    current = theme
    const generationAtSet = ++generation
    if (theme !== FILE_ICON_THEME_COLORED) {
      dropRegistrations()
      return
    }
    loadChunk('file-icons').then((chunk) => {
      if (generationAtSet !== generation) return
      const register = chunk.registerColoredFileIcons as ColoredRegistrar | undefined
      if (typeof register !== 'function') {
        console.error('[dsh-better-sidebar] file-icons chunk exports no registerColoredFileIcons')
        return
      }
      unregister = register(service)
    }).catch((error: unknown) => {
      if (generationAtSet !== generation) return
      console.error('[dsh-better-sidebar] file-icons chunk failed to load:', error)
    })
  }

  return {
    set,
    dispose: () => {
      generation += 1
      current = undefined
      dropRegistrations()
    },
  }
}
