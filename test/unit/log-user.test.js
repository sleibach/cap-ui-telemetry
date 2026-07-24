'use strict'

jest.mock('@sap/cds', () => ({ context: undefined }))
const cds = require('@sap/cds')
const { shouldLogUser, resolveUserId } = require('../../dist/lib/log-user')

describe('shouldLogUser', () => {
  const logger = { _error: true, _warn: true, _info: true, _debug: false }

  it('never returns false regardless of active levels', () => {
    expect(shouldLogUser('never', { _error: true, _warn: true, _info: true, _debug: true })).toBe(false)
  })

  it('debug (default) requires the debug flag specifically', () => {
    expect(shouldLogUser('debug', logger)).toBe(false)
    expect(shouldLogUser('debug', { ...logger, _debug: true })).toBe(true)
  })

  it('info/warn/error check their own flag, independent of debug', () => {
    expect(shouldLogUser('info', logger)).toBe(true)
    expect(shouldLogUser('warn', logger)).toBe(true)
    expect(shouldLogUser('error', logger)).toBe(true)
    expect(shouldLogUser('error', { _error: false, _warn: false, _info: false, _debug: false })).toBe(false)
  })
})

describe('resolveUserId', () => {
  afterEach(() => {
    cds.context = undefined
  })

  it('returns undefined when there is no request context', () => {
    expect(resolveUserId()).toBeUndefined()
  })

  it('returns the current user id when a context is established', () => {
    cds.context = { user: { id: 'alice' } }
    expect(resolveUserId()).toBe('alice')
  })

  it('returns undefined when context has no user (e.g. unauthenticated)', () => {
    cds.context = {}
    expect(resolveUserId()).toBeUndefined()
  })
})
