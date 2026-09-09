/**
 * Unit tests for the file-address grammar (src/client/resource-address.ts):
 * the plugin parses DSH's `dsh-resource://file/…` addresses itself (the
 * client bundle's purity gate forbids value-importing the upstream util), so
 * these tests pin the upstream shapes it must agree with.
 */
import { describe, expect, it } from 'vitest'
import {
  absoluteFileAddress,
  fileAddressFor,
  parseFileAddress,
  sessionFileAddress,
} from '../src/client/resource-address.ts'

describe('parseFileAddress', () => {
  it('reads a session-scoped address', () => {
    expect(parseFileAddress('dsh-resource://file/session/s1/src/a.ts')).toEqual({
      scope: 'session', sessionId: 's1', path: 'src/a.ts',
    })
  })

  it('reads an absolute address (POSIX, drive, UNC)', () => {
    expect(parseFileAddress('dsh-resource://file/absolute/home/me/notes.txt')).toEqual({
      scope: 'absolute', path: '/home/me/notes.txt',
    })
    expect(parseFileAddress('dsh-resource://file/absolute/C:/x/y.txt')).toEqual({
      scope: 'absolute', path: 'C:/x/y.txt',
    })
    expect(parseFileAddress('dsh-resource://file/absolute//server/share/x.txt')).toEqual({
      scope: 'absolute', path: '//server/share/x.txt',
    })
  })

  it('decodes per segment so #, ? and spaces survive', () => {
    expect(parseFileAddress('dsh-resource://file/session/s1/a%20b/c%23d.txt')).toEqual({
      scope: 'session', sessionId: 's1', path: 'a b/c#d.txt',
    })
  })

  it('refuses anything that is not a file address', () => {
    for (const address of [
      'sidebar://guide',
      'dsh-resource://attachment/session/s1/a.png',
      'dsh-resource://file/other/s1/a.ts',
      'dsh-resource://file/session/s1',
      'dsh-resource://file/absolute/',
      'not a url',
    ]) {
      expect(parseFileAddress(address), address).toBeUndefined()
    }
  })
})

describe('address builders', () => {
  it('builds a session address and round-trips it', () => {
    const address = sessionFileAddress('s1', './src\\a b.ts')
    expect(address).toBe('dsh-resource://file/session/s1/src/a%20b.ts')
    expect(parseFileAddress(address)).toEqual({ scope: 'session', sessionId: 's1', path: 'src/a b.ts' })
  })

  it('builds an absolute address and round-trips it', () => {
    for (const [path, address] of [
      ['/home/me/x.txt', 'dsh-resource://file/absolute/home/me/x.txt'],
      ['C:\\x\\y.txt', 'dsh-resource://file/absolute/C:/x/y.txt'],
      ['\\\\server\\share\\x.txt', 'dsh-resource://file/absolute//server/share/x.txt'],
    ] as const) {
      expect(absoluteFileAddress(path)).toBe(address)
      expect(parseFileAddress(address)?.path.replace(/\\/g, '/')).toBe(path.replace(/\\/g, '/'))
    }
  })

  it('keeps a drive colon literal', () => {
    expect(absoluteFileAddress('C:/x/y.txt')).toContain('C:')
    expect(absoluteFileAddress('C:/x/y.txt')).not.toContain('%3A')
  })
})

describe('fileAddressFor', () => {
  it('scopes a relative path to the session', () => {
    expect(fileAddressFor('s1', '/work', 'src/a.ts')).toBe('dsh-resource://file/session/s1/src/a.ts')
  })

  it('scopes an absolute path inside the workspace to the session', () => {
    expect(fileAddressFor('s1', '/work', '/work/src/a.ts')).toBe('dsh-resource://file/session/s1/src/a.ts')
  })

  it('scopes the workspace root itself to the session', () => {
    expect(fileAddressFor('s1', '/work', '/work')).toBe('dsh-resource://file/session/s1/')
  })

  it('falls back to an absolute address outside the workspace (or with no cwd)', () => {
    expect(fileAddressFor('s1', '/work', '/other/a.ts')).toBe('dsh-resource://file/absolute/other/a.ts')
    expect(fileAddressFor('s1', undefined, '/other/a.ts')).toBe('dsh-resource://file/absolute/other/a.ts')
  })
})
