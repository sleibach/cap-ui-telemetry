const cds = require('@sap/cds')
const { join } = require('path')

const test = cds.test(join(__dirname, '../app'))
const AUTH = { auth: { username: 'alice', password: '' } }

function entry(overrides = {}) {
  return {
    level: 'error',
    message: 'boom',
    stackTrace: 'Error: boom\n    at x (app.js:1:1)',
    errorSource: 'window-error',
    appName: 'cspquotes',
    componentName: 'csportal.quotes.Component',
    url: 'https://example.com/app',
    userAgent: 'Mozilla/5',
    timestamp: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('cap-ui-telemetry — TelemetryService.errors, against a booted CAP app', () => {
  const log = cds.test.log()

  it('logs each entry in a batch and reports how many were accepted', async () => {
    log.clear()
    const { data } = await test.POST(
      '/service/telemetry/errors',
      { entries: [entry(), entry({ level: 'warning', message: 'careful' })] },
      AUTH,
    )
    expect(data.accepted).toBe(2)
    expect(log.output).toContain('[ui-error]')
    expect(log.output).toContain('Client error: boom')
    expect(log.output).toContain('Client error: careful')
  })

  it('rejects unauthenticated requests', async () => {
    await expect(test.POST('/service/telemetry/errors', { entries: [entry()] })).rejects.toThrow(/401|403/)
  })

  it('rejects a batch larger than maxBatchSize (50)', async () => {
    const entries = Array.from({ length: 51 }, () => entry())
    await expect(test.POST('/service/telemetry/errors', { entries }, AUTH)).rejects.toThrow(/400/)
  })

  it('accepts a batch right at maxBatchSize (50)', async () => {
    const entries = Array.from({ length: 50 }, () => entry())
    const { data } = await test.POST('/service/telemetry/errors', { entries }, AUTH)
    expect(data.accepted).toBe(50)
  })

  it('truncates an oversized message rather than rejecting the entry', async () => {
    log.clear()
    const { data } = await test.POST(
      '/service/telemetry/errors',
      { entries: [entry({ message: 'x'.repeat(5000) })] },
      AUTH,
    )
    expect(data.accepted).toBe(1)
  })

  it('rejects entries with unknown properties at the protocol layer (defense in depth)', async () => {
    // CAP's own input validation refuses properties not declared on ClientErrorEntry —
    // the request never reaches our handler at all. error-log.ts's whitelist-copy
    // (toLogRecord, see unit tests) is a second, independent layer for whatever
    // protocol/CAP-version combination might not enforce this.
    log.clear()
    await expect(
      test.POST('/service/telemetry/errors', { entries: [entry({ evilField: 'DROP TABLE Notes' })] }, AUTH),
    ).rejects.toThrow(/400/)
    expect(log.output).not.toContain('DROP TABLE')
  })
})
