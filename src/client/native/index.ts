/**
 * The plugin's content, registered into DSH's native right Sidebar.
 *
 * Every tab the plugin can draw becomes a native tab TYPE plus a BODY:
 *
 * - the `editor` type is both a page (the files window) and a resource
 *   viewer — it claims `dsh-resource://file/**` at the default `extension`
 *   band, which outranks the built-in `text` preview (`fallback`) and the
 *   built-in `files` tree (`builtin`), so every file the product opens lands
 *   in the plugin's editor;
 * - the built-in `files` page kind is TAKEN OVER by an `extension`
 *   registration of the same kind, so `openTab('files')` draws the plugin's
 *   explorer instead of the built-in tree; the built-in resumes when this
 *   plugin unregisters;
 * - every other descriptor (changes / subagent / side chat / terminal /
 *   browser / diff) becomes a page type of its own.
 *
 * The registrations follow the plugin's registry lifecycle: a descriptor
 * registered later (an external plugin) gets its native type too, and a type
 * the user disabled in the side-card settings is unregistered — so it is
 * absent from the native guide and `openTab` refuses it.
 */
import type { Context } from '../../context-types.ts'
import { t } from '../locales.ts'
import { parseFileAddress } from '../resource-address.ts'
import type { BetterSidebarService, TabDescriptor } from '../service.ts'
import type { SidebarStore } from '../state.ts'
import {
  NativeTabBody,
  NativeTabTitle,
  type NativeBodyInjected,
  type NativeTabInfo,
  type NativeTabParams,
  type NativeTabRecords,
} from './tab-adapter.tsx'

/** The native tab-type registry face (`ctx.sidebarRightTabs`). */
interface NativeTabRegistry {
  register(definition: {
    id: string
    kind: string
    patterns?: readonly string[]
    priority?: 'extension' | 'builtin' | 'fallback'
    canOpen?: (address: string) => boolean
    title: (address: string) => string
    guide?: readonly { order: number; title: () => string; description: () => string; icon?: unknown }[]
  }): () => void
}

/** The kind the plugin's files window owns (page + file viewer). */
const EDITOR_KIND = 'editor'

/** The built-in page kind this plugin takes over. */
const FILES_KIND = 'files'

/** The plugin's implementation id for a descriptor (unique across kinds). */
function nativeId(descriptorId: string): string {
  return `dsh-better-sidebar:${descriptorId}`
}

/** The descriptor's title text, evaluated fresh for the current locale. */
function titleOf(descriptor: TabDescriptor): string {
  return typeof descriptor.title === 'function' ? descriptor.title() : descriptor.title
}

/** One descriptor's live native registrations. */
interface Registration {
  readonly dispose: () => void
}

/** Everything the registrations need. */
export interface NativeSurfaceDeps {
  readonly ctx: Context
  readonly store: SidebarStore
  readonly service: BetterSidebarService
  /** The shared native tab record registry (the surface writes it too). */
  readonly records: NativeTabRecords
}

/**
 * Register the plugin's tabs into the native right Sidebar and keep them in
 * step with the plugin's own registry and settings.
 * @param deps - client context, the plugin store/service, and the records.
 * @returns a disposer unregistering everything.
 */
export function registerNativeSurface(deps: NativeSurfaceDeps): () => void {
  const { ctx, store, service, records } = deps
  const disposers: Array<() => void> = []
  // The native seat declares `sidebar.right.pane.tab` when its client half
  // activates, which may be after this plugin; the slot registry's `inject`
  // re-runs on every declaration lifetime, and the tab-type registry
  // (`ctx.sidebarRightTabs`) is provided by that same package, so one wait
  // covers both.
  const disposeSeat = ctx.slots.inject('sidebar.right.pane.tab', () => {
    const tabs = ctx.get('sidebarRightTabs') as unknown as NativeTabRegistry | undefined
    if (tabs === undefined) return () => {}
    const live = new Map<string, Registration>()

    const fileParamsOf = (info: NativeTabInfo): NativeTabParams | undefined => {
      const address = parseFileAddress(info.tab.contentId)
      return address === undefined ? undefined : { path: address.path }
    }
    const fileSessionIdOf = (info: NativeTabInfo): string | undefined => {
      const address = parseFileAddress(info.tab.contentId)
      return address !== undefined && address.scope === 'session' ? address.sessionId : undefined
    }

    /** Register the body + chip-title slots for one native implementation id. */
    const registerSlots = (
      id: string,
      injected: Omit<NativeBodyInjected, 'sessionId'>,
      params: Pick<NativeBodyInjected, 'paramsOf' | 'sessionIdOf'>,
    ): Array<() => void> => [
      ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: id,
        inject: (sessionId: string) => ({ ...injected, ...params, sessionId }),
      }, NativeTabBody)),
      ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab.title',
        key: id,
        inject: () => ({ records }),
      }, NativeTabTitle)),
    ]

    /** One descriptor's native type + body + title, as one disposable. */
    const registerDescriptor = (descriptor: TabDescriptor): (() => void) => {
      const id = nativeId(descriptor.id)
      const isEditor = descriptor.id === EDITOR_KIND
      const icon = descriptor.icon
      const disposeType = tabs.register({
        id,
        kind: descriptor.id,
        ...(isEditor
          ? {
            patterns: ['dsh-resource://file/**'],
            canOpen: (address: string) => parseFileAddress(address) !== undefined,
          }
          : {}),
        // An external implementation outranks the product's own viewers, which
        // is what lets the plugin's editor take over file addresses.
        priority: 'extension',
        title: () => titleOf(descriptor),
        ...(descriptor.hidden === true
          ? {}
          : {
            guide: [{
              order: descriptor.order ?? 100,
              title: () => titleOf(descriptor),
              description: () => t('nativeGuideDesc'),
              ...(typeof icon === 'function'
                ? { icon: (props: { size?: number }) => icon(props.size ?? 16) }
                : {}),
            }],
          }),
      })
      const slots = registerSlots(
        id,
        { ctx, store, service, records, descriptorId: descriptor.id },
        isEditor ? { paramsOf: fileParamsOf, sessionIdOf: fileSessionIdOf } : {},
      )
      return () => {
        for (const dispose of slots.reverse()) dispose()
        disposeType()
      }
    }

    /** One `files`-kind takeover: the plugin's explorer under the built-in kind. */
    const registerFilesKind = (): (() => void) => {
      const id = 'dsh-better-sidebar:files'
      const disposeType = tabs.register({
        id,
        kind: FILES_KIND,
        priority: 'extension',
        title: () => t('files'),
        guide: [{
          order: 10,
          title: () => t('files'),
          description: () => t('nativeGuideDesc'),
        }],
      })
      const slots = registerSlots(id, { ctx, store, service, records, descriptorId: EDITOR_KIND }, {})
      return () => {
        for (const dispose of slots.reverse()) dispose()
        disposeType()
      }
    }

    /** Bring the live registrations in line with the registry + the settings. */
    const sync = (): void => {
      const wanted = new Map<string, () => () => void>()
      for (const descriptor of service.getTabs()) {
        if (!service.isTabEnabled(descriptor.id)) continue
        wanted.set(descriptor.id, () => registerDescriptor(descriptor))
      }
      for (const [descriptorId, registration] of live) {
        if (wanted.has(descriptorId)) continue
        registration.dispose()
        live.delete(descriptorId)
      }
      for (const [descriptorId, create] of wanted) {
        if (live.has(descriptorId)) continue
        live.set(descriptorId, { dispose: create() })
      }
      // The built-in files kind follows the editor type's switch: with the
      // editor disabled the plugin has no explorer to put there.
      const wantsFiles = service.isTabEnabled(EDITOR_KIND)
      const hasFiles = live.has(FILES_KIND)
      if (wantsFiles && !hasFiles) live.set(FILES_KIND, { dispose: registerFilesKind() })
      if (!wantsFiles && hasFiles) {
        live.get(FILES_KIND)?.dispose()
        live.delete(FILES_KIND)
      }
    }

    disposers.push(service.subscribe(sync), store.subscribe(sync))
    sync()
    return () => {
      for (const registration of live.values()) registration.dispose()
      live.clear()
    }
  })
  return () => {
    disposeSeat()
    for (const dispose of disposers.reverse()) dispose()
  }
}

export type { NativeTabRecords }
