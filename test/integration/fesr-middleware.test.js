const cds = require('@sap/cds')
const { join } = require('path')

const test = cds.test(join(__dirname, '../app'))

// Real-shaped sample values, matching UI5's createFESR()/createFESRopt() layout.
const SAMPLE_FESREC =
  '0050568B7A121EE5A8D0C6B7A1234567,0050568B7A121EE5A8D0C6B7A1234568,12,345,1204,2,click_press_3,400,380,mac_15.5,SAP_UI5'
const SAMPLE_FESREC_OPT =
  'cspquotes,click_press,,Chrome_120,1024,20480,,,150,X,,,,,200,2,2,1204,20240923101512345,csportal.quotes.Component'

const AUTH = { auth: { username: 'alice', password: '' } }

describe('cap-ui-telemetry — FESR middleware, against a booted CAP app', () => {
  const log = cds.test.log()

  it('emits one ui-fesr record when both piggyback headers are present', async () => {
    log.clear()
    const res = await test.GET('/rest/sample/Notes', {
      headers: { 'SAP-Perf-FESRec': SAMPLE_FESREC, 'SAP-Perf-FESRec-opt': SAMPLE_FESREC_OPT },
      ...AUTH,
    })
    expect(res.status).toBe(200)
    expect(log.output).toContain('[ui-fesr]')
    expect(log.output).toContain('FESR interaction')
    expect(log.output).toContain('cspquotes')
    expect(log.output).toContain('interactionDuration: 1204')
  })

  it('emits nothing when the piggyback headers are absent', async () => {
    log.clear()
    await test.GET('/rest/sample/Notes', AUTH)
    expect(log.output).not.toContain('ui-fesr')
  })

  it('tolerates a wrong field count — logs a partial record, request still succeeds', async () => {
    // The accompanying debug-level warning (see fesr-parser.ts) only prints
    // when DEBUG=ui-telemetry is set — cds.log('x').debug() is a no-op below
    // the DEBUG level (@sap/cds/lib/log/cds-log.js), which is the default here.
    log.clear()
    const res = await test.GET('/rest/sample/Notes', {
      headers: { 'SAP-Perf-FESRec': 'not,even,close,to,valid' },
      ...AUTH,
    })
    expect(res.status).toBe(200)
    expect(log.output).toContain('FESR interaction') // parses what it can (rootContextId: 'not', ...)
  })

  it('tolerates the mandatory header without the optional one', async () => {
    log.clear()
    const res = await test.GET('/rest/sample/Notes', {
      headers: { 'SAP-Perf-FESRec': SAMPLE_FESREC },
      ...AUTH,
    })
    expect(res.status).toBe(200)
    expect(log.output).toContain('FESR interaction')
  })
})
