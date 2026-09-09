// @vitest-environment jsdom
/**
 * Unit tests for the native-surface adapter: the per-tab record registry
 * (src/client/native/tab-adapter.tsx) and the service's routing into it
 * (src/client/service.ts `setSurface`).
 */
import { describe, expect, it, vi } from 'vitest'
import { createNativeTabRecords } from '../src/client/native/tab-adapter.tsx'
import { createBetterSidebarService, type SidebarSurface } from '../src/client/service.ts'
import { createSidebarStore } from '../src/client/state.ts'

const scope = { sessionId: 's1', cwd: '/work' }

describe('createNativeTabRecords', () => {
  it('mints a synthetic tab from the native record + params', () => {
    const records = createNativeTabRecords()
    const view = records.ensure({
      id: 'tab-1', kind: 'browser', title: 'Browser', params: { url: 'https://a.test', meta: { k: 1 } }, scope,
    })
    expect(view.tab).toMatchObject({ id: 'tab-1', type: 'browser', title: 'Browser', meta: { k: 1 } })
    expect(view.scope).toBe(scope)
    expect(view.expanded).toEqual([])
  })

  it('calls the descriptor factory once for a record that arrives without seed fields', () => {
    const records = createNativeTabRecords()
    const mint = vi.fn(() => ({ title: 'Side chat', meta: { autoCreate: true } }))
    const view = records.ensure({ id: 'tab-2', kind: 'sidechat', title: 'Side Chat', params: undefined, scope, mint })
    expect(mint).toHaveBeenCalledTimes(1)
    expect(view.tab).toMatchObject({ title: 'Side chat', meta: { autoCreate: true } })
    // A second render of the same record does not re-mint.
    records.ensure({ id: 'tab-2', kind: 'sidechat', title: 'Side Chat', params: undefined, scope, mint })
    expect(mint).toHaveBeenCalledTimes(1)
  })

  it('refreshes the seed fields on navigation but keeps the record identity', () => {
    const records = createNativeTabRecords()
    records.ensure({ id: 'tab-3', kind: 'editor', title: 'a.ts', params: { path: '/work/a.ts' }, scope })
    records.update('tab-3', { title: 'renamed.ts' })
    const view = records.ensure({ id: 'tab-3', kind: 'editor', title: 'b.ts', params: { path: '/work/b.ts' }, scope })
    expect(view.tab).toMatchObject({ id: 'tab-3', path: '/work/b.ts', title: 'renamed.ts' })
  })

  it('tracks expansion per record and bumps its version', () => {
    const records = createNativeTabRecords()
    records.ensure({ id: 'tab-4', kind: 'editor', title: 'Files', params: undefined, scope })
    const before = records.versionOf('tab-4')
    records.toggleExpanded('tab-4', '/work/src')
    expect(records.get('tab-4')?.expanded).toEqual(['/work/src'])
    expect(records.versionOf('tab-4')).toBeGreaterThan(before)
    records.toggleExpanded('tab-4', '/work/src')
    expect(records.get('tab-4')?.expanded).toEqual([])
  })

  it('notifies subscribers and forgets a dropped record', () => {
    const records = createNativeTabRecords()
    records.ensure({ id: 'tab-5', kind: 'terminal', title: 'Terminal', params: undefined, scope })
    const listener = vi.fn()
    const off = records.subscribe(listener)
    records.update('tab-5', { title: 'zsh' })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(records.get('tab-5')?.tab.title).toBe('zsh')
    records.drop('tab-5')
    expect(records.has('tab-5')).toBe(false)
    off()
    records.ensure({ id: 'tab-6', kind: 'terminal', title: 'Terminal', params: undefined, scope })
    records.update('tab-6', { title: 'x' })
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('service routing into the native surface', () => {
  const mount = (): { surface: SidebarSurface; calls: unknown[]; service: ReturnType<typeof createBetterSidebarService> } => {
    const calls: unknown[] = []
    const surface: SidebarSurface = {
      openTab: input => { calls.push({ op: 'openTab', ...input }) },
      openResource: input => { calls.push({ op: 'openResource', ...input }) },
      fileAddress: (sessionId, cwd, path) => `addr://${sessionId}${cwd === undefined ? '' : cwd}${path}`,
      close: (sessionId, tabId) => ({ type: 'terminal', title: `closed ${tabId} in ${sessionId}` }),
      update: tabId => tabId === 'native-1',
      activate: tabId => tabId === 'native-1',
      has: tabId => tabId === 'native-1',
    }
    const store = createSidebarStore()
    store.setSession('s1')
    const service = createBetterSidebarService(store)
    service.setSurface(surface)
    service.registerTab({ id: 'terminal', title: 'Terminal', createTab: state => ({ tab: { id: `terminal:${state.nextTerminal}`, type: 'terminal', title: 'Terminal', meta: { n: state.nextTerminal } } }) })
    service.registerTab({ id: 'git', title: 'Changes', component: () => null })
    service.registerTab({ id: 'editor', title: 'Files', component: () => null })
    return { surface, calls, service }
  }

  it('opens a page type natively, carrying the descriptor factory seed', () => {
    const { service, calls } = mount()
    service.openTab({ type: 'terminal' }, scope)
    expect(calls).toEqual([{
      op: 'openTab',
      sessionId: 's1',
      kind: 'terminal',
      params: { title: 'Terminal', meta: { n: 1 } },
      revealIfOpened: false,
    }])
  })

  it('opens a file path as a resource address', () => {
    const { service, calls } = mount()
    service.openTab({ type: 'editor', path: '/work/a.ts', title: 'a.ts' }, scope)
    expect(calls).toEqual([{ op: 'openResource', sessionId: 's1', address: 'addr://s1/work/work/a.ts', revealIfOpened: true }])
  })

  it('maps a path-less editor open to the files page kind', () => {
    const { service, calls } = mount()
    service.openTab({ type: 'editor' }, scope)
    expect(calls).toEqual([{ op: 'openTab', sessionId: 's1', kind: 'files', params: {}, revealIfOpened: true }])
  })

  it('keeps a bottom-targeted open in the plugin layout', () => {
    const { service, calls } = mount()
    service.openTab({ type: 'terminal', target: 'bottom' }, scope)
    expect(calls).toEqual([])
  })

  it('routes record operations to the native surface when the id is native', () => {
    const { service } = mount()
    expect(() => service.updateTab('native-1', { title: 'x' })).not.toThrow()
    expect(() => service.activateTab('native-1')).not.toThrow()
    expect(() => service.closeTab('native-1', scope)).not.toThrow()
    // A non-native id keeps the plugin's own layout path (a strict no-op here).
    expect(() => service.updateTab('other', { title: 'x' })).not.toThrow()
    expect(() => service.closeTab('other', scope)).not.toThrow()
  })

  it('refuses a disabled type before touching the surface', () => {
    const { service, calls } = mount()
    service.setSurface(undefined)
    const store = createSidebarStore()
    void store
    service.setSurface({
      openTab: input => { calls.push({ op: 'openTab', ...input }) },
      openResource: () => { calls.push({ op: 'openResource' }) },
      fileAddress: () => 'addr',
      close: () => undefined,
      update: () => false,
      activate: () => false,
      has: () => false,
    })
    service.openTab({ type: 'missing' }, scope)
    expect(calls).toEqual([])
  })
})
