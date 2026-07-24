'use strict'

const mockLoggers = {}
function mockMakeLogger() {
  return { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }
}
jest.mock('@sap/cds', () => ({
  log: (name) => (mockLoggers[name] ??= mockMakeLogger()),
  context: undefined,
}))
const cds = require('@sap/cds')

const { toLogRecord, logClientError } = require('../../dist/lib/error-log')

const CONFIG = {
  enabled: true,
  logger: 'ui-error',
  path: '/service/telemetry',
  maxBatchSize: 50,
  maxMessageLength: 20,
  maxStackLength: 30,
}

const PLUGIN_CONFIG = { errors: CONFIG, logUserOn: 'debug' }

beforeEach(() => {
  Object.values(mockLoggers).forEach((l) =>
    Object.values(l).forEach((fn) => typeof fn === 'function' && fn.mock && fn.mockClear()),
  )
})

describe('toLogRecord — level mapping', () => {
  it.each([
    ['error', 'error'],
    ['warning', 'warn'],
    ['info', 'info'],
    ['debug', 'info'],
    [undefined, 'info'],
  ])('maps client level %s to %s', (input, expected) => {
    expect(toLogRecord({ level: input }, CONFIG).errorLevel).toBe(expected)
  })
})

describe('toLogRecord — truncation', () => {
  it('truncates message to maxMessageLength', () => {
    const record = toLogRecord({ message: 'x'.repeat(100) }, CONFIG)
    expect(record.errorMessage).toHaveLength(20)
  })

  it('truncates stackTrace to maxStackLength', () => {
    const record = toLogRecord({ stackTrace: 'y'.repeat(100) }, CONFIG)
    expect(record.stackTrace).toHaveLength(30)
  })

  it('leaves short values untouched', () => {
    const record = toLogRecord({ message: 'short' }, CONFIG)
    expect(record.errorMessage).toBe('short')
  })
})

describe('toLogRecord — whitelist and sanitization', () => {
  it('only copies known fields, dropping anything else on the client payload', () => {
    const record = toLogRecord({ message: 'hi', evilField: 'DROP TABLE', __proto__: { polluted: true } }, CONFIG)
    expect(Object.keys(record).sort()).toEqual(
      [
        'errorLevel',
        'errorMessage',
        'stackTrace',
        'errorSource',
        'appName',
        'componentName',
        'clientUrl',
        'clientUserAgent',
        'clientTimestamp',
      ].sort(),
    )
    expect(record.evilField).toBeUndefined()
  })

  it('strips control characters (log-injection guard)', () => {
    const record = toLogRecord({ message: 'line1\r\nline2\tend' }, CONFIG)
    expect(record.errorMessage).toBe('line1  line2 end')
  })

  it('renames client field names to their log-record equivalents', () => {
    const record = toLogRecord(
      { url: 'https://example.com/app', userAgent: 'Mozilla/5', timestamp: '2026-01-01T00:00:00Z' },
      CONFIG,
    )
    expect(record.clientUrl).toBe('https://example.com/app')
    expect(record.clientUserAgent).toBe('Mozilla/5')
    expect(record.clientTimestamp).toBe('2026-01-01T00:00:00Z')
  })

  it('omits empty/non-string values rather than emitting empty strings', () => {
    const record = toLogRecord({ message: '', appName: 123 }, CONFIG)
    expect(record.errorMessage).toBeUndefined()
    expect(record.appName).toBeUndefined()
  })
})

describe('logClientError — level routing, never passes an Error instance', () => {
  it('routes level=error to LOG.error', () => {
    logClientError({ level: 'error', message: 'boom' }, PLUGIN_CONFIG)
    expect(mockLoggers['ui-error'].error).toHaveBeenCalledTimes(1)
    const [message, record] = mockLoggers['ui-error'].error.mock.calls[0]
    expect(typeof message).toBe('string')
    expect(record).not.toBeInstanceOf(Error)
    expect(record.errorLevel).toBe('error')
  })

  it('routes level=warning to LOG.warn', () => {
    logClientError({ level: 'warning', message: 'careful' }, PLUGIN_CONFIG)
    expect(mockLoggers['ui-error'].warn).toHaveBeenCalledTimes(1)
  })

  it('routes anything else to LOG.info', () => {
    logClientError({ level: 'debug', message: 'fyi' }, PLUGIN_CONFIG)
    expect(mockLoggers['ui-error'].info).toHaveBeenCalledTimes(1)
  })
})

describe('logClientError — user attachment (logUserOn)', () => {
  afterEach(() => {
    cds.context = undefined
  })

  it('does not attach user when the logger is below the logUserOn threshold', () => {
    const logger = cds.log('ui-error-below-threshold') // _debug left undefined -> false
    cds.context = { user: { id: 'alice' } }
    logClientError(
      { level: 'error', message: 'boom' },
      { errors: { ...CONFIG, logger: 'ui-error-below-threshold' }, logUserOn: 'debug' },
    )
    const [, record] = logger.error.mock.calls.at(-1)
    expect(record.user).toBeUndefined()
  })

  it('attaches cds.context.user.id once the configured level is active', () => {
    const logger = cds.log('ui-error-active')
    logger._debug = true
    cds.context = { user: { id: 'bob' } }
    logClientError(
      { level: 'error', message: 'boom' },
      { errors: { ...CONFIG, logger: 'ui-error-active' }, logUserOn: 'debug' },
    )
    const [, record] = logger.error.mock.calls.at(-1)
    expect(record.user).toBe('bob')
  })

  it('never attaches user when logUserOn is "never", regardless of active level', () => {
    const logger = cds.log('ui-error-never')
    logger._debug = true
    logger._error = true
    cds.context = { user: { id: 'carol' } }
    logClientError(
      { level: 'error', message: 'boom' },
      { errors: { ...CONFIG, logger: 'ui-error-never' }, logUserOn: 'never' },
    )
    const [, record] = logger.error.mock.calls.at(-1)
    expect(record.user).toBeUndefined()
  })

  it('does not attach user when no request context/user is established, even if active', () => {
    const logger = cds.log('ui-error-no-user')
    logger._debug = true
    cds.context = undefined
    logClientError(
      { level: 'error', message: 'boom' },
      { errors: { ...CONFIG, logger: 'ui-error-no-user' }, logUserOn: 'debug' },
    )
    const [, record] = logger.error.mock.calls.at(-1)
    expect(record.user).toBeUndefined()
  })
})
