'use strict'
const { injectTelemetryServiceModel } = require('../../dist/lib/telemetry-service-model')

const SERVICE_FQN = 'cap.ui.telemetry.TelemetryService'
const ENTRY_TYPE_FQN = `${SERVICE_FQN}.ClientErrorEntry`
const ERRORS_ACTION_FQN = `${SERVICE_FQN}.errors`

const CONFIG = {
  enabled: true,
  logger: 'ui-error',
  path: '/service/telemetry',
  maxBatchSize: 50,
  maxMessageLength: 2048,
  maxStackLength: 8192,
}

describe('injectTelemetryServiceModel', () => {
  it('no-ops when the CSN fragment has no definitions', () => {
    expect(() => injectTelemetryServiceModel({}, CONFIG)).not.toThrow()
  })

  it('injects the service, its ClientErrorEntry type, and its errors action', () => {
    const csn = { definitions: {} }
    injectTelemetryServiceModel(csn, CONFIG)

    expect(csn.definitions[SERVICE_FQN]).toMatchObject({
      kind: 'service',
      '@protocol': 'rest',
      '@path': '/service/telemetry',
      '@requires': 'authenticated-user',
    })
    expect(csn.definitions[ENTRY_TYPE_FQN].kind).toBe('type')
    expect(csn.definitions[ERRORS_ACTION_FQN]).toMatchObject({
      kind: 'action',
      params: { entries: { items: { type: ENTRY_TYPE_FQN } } },
      returns: { elements: { accepted: { type: 'cds.Integer' } } },
    })
  })

  it('declares ClientErrorEntry fields unbounded (LargeString) so CAP never rejects on length', () => {
    // A declared cds.String(n) would make the REST adapter reject an oversized
    // value with 400 before error-log.ts's own truncation ever runs — the
    // opposite of the "truncate, never reject" design. See telemetry-service-model.ts.
    const csn = { definitions: {} }
    injectTelemetryServiceModel(csn, CONFIG)
    const elements = csn.definitions[ENTRY_TYPE_FQN].elements
    for (const el of Object.values(elements)) {
      expect(el.type).toBe('cds.LargeString')
      expect(el.length).toBeUndefined()
    }
  })

  it('applies the configured @path', () => {
    const csn = { definitions: {} }
    injectTelemetryServiceModel(csn, { ...CONFIG, path: '/api/telemetry' })
    expect(csn.definitions[SERVICE_FQN]['@path']).toBe('/api/telemetry')
  })

  it('injects nothing at all when disabled', () => {
    const csn = { definitions: {} }
    injectTelemetryServiceModel(csn, { ...CONFIG, enabled: false })
    expect(csn.definitions[SERVICE_FQN]).toBeUndefined()
    expect(csn.definitions[ENTRY_TYPE_FQN]).toBeUndefined()
    expect(csn.definitions[ERRORS_ACTION_FQN]).toBeUndefined()
  })

  it('is idempotent across repeated calls (loaded fires per fragment)', () => {
    const csn = { definitions: {} }
    injectTelemetryServiceModel(csn, CONFIG)
    injectTelemetryServiceModel(csn, { ...CONFIG, path: '/should-not-apply' })
    expect(csn.definitions[SERVICE_FQN]['@path']).toBe('/service/telemetry')
  })
})
