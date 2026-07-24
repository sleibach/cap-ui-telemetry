'use strict'
const { parseFesrec, parseFesrecOpt, parseFesrHeaders } = require('../../dist/lib/fesr-parser')

// Real-shaped sample values, matching UI5's createFESR()/createFESRopt() layout
// (sap/ui/performance/trace/FESR.js).
const SAMPLE_FESREC =
  '0050568B7A121EE5A8D0C6B7A1234567,0050568B7A121EE5A8D0C6B7A1234568,12,345,1204,2,click_press_3,400,380,mac_15.5,SAP_UI5'
const SAMPLE_FESREC_OPT =
  'cspquotes,click_press,,Chrome_120,1024,20480,,,150,X,,,,,200,2,2,1204,20240923101512345,csportal.quotes.Component'

describe('parseFesrec (mandatory SAP-Perf-FESRec)', () => {
  it('parses all 11 positional fields', () => {
    const { record, dirty, warning } = parseFesrec(SAMPLE_FESREC)
    expect(warning).toBeUndefined()
    expect(dirty).toBe(false)
    expect(record).toEqual({
      rootContextId: '0050568B7A121EE5A8D0C6B7A1234567',
      fesrTransactionId: '0050568B7A121EE5A8D0C6B7A1234568',
      clientNavigationTime: 12,
      clientRoundTripTime: 345,
      interactionDuration: 1204,
      completedRoundTrips: 2,
      passportAction: 'click_press_3',
      networkTime: 400,
      requestTime: 380,
      clientOS: 'mac_15.5',
    })
  })

  it('drops the constant clientType field (index 10) — no filtering value', () => {
    const { record } = parseFesrec(SAMPLE_FESREC)
    expect(record.clientType).toBeUndefined()
  })

  it('flags -1 as a dirty marker but keeps the value', () => {
    const dirtyHeader =
      '0050568B7A121EE5A8D0C6B7A1234567,0050568B7A121EE5A8D0C6B7A1234568,-1,345,1204,2,click_press_3,400,380,mac_15.5,SAP_UI5'
    const { record, dirty } = parseFesrec(dirtyHeader)
    expect(dirty).toBe(true)
    expect(record.clientNavigationTime).toBe(-1)
  })

  it('warns (does not throw) on unexpected field count', () => {
    const { record, warning } = parseFesrec('a,b,c')
    expect(warning).toMatch(/expected 11.*got 3/)
    expect(record.rootContextId).toBe('a')
    expect(record.fesrTransactionId).toBe('b')
  })

  it('treats empty string fields as absent, not empty-string values', () => {
    const { record } = parseFesrec(',,,,,,,,,,')
    expect(record.rootContextId).toBeUndefined()
    expect(record.clientNavigationTime).toBeUndefined()
  })
})

describe('parseFesrecOpt (optional SAP-Perf-FESRec-opt)', () => {
  it('parses all mapped fields and skips unassigned/persistency slots', () => {
    const { record, dirty, warning } = parseFesrecOpt(SAMPLE_FESREC_OPT)
    expect(warning).toBeUndefined()
    expect(dirty).toBe(false)
    expect(record).toEqual({
      appName: 'cspquotes',
      stepName: 'click_press',
      clientModel: 'Chrome_120',
      bytesSent: 1024,
      bytesReceived: 20480,
      clientProcessingTime: 150,
      compressed: true,
      busyDuration: 200,
      interactionType: 2,
      clientDevice: 2,
      legacyDuration: 1204,
      interactionStartTime: '20240923101512345',
      appNameLong: 'csportal.quotes.Component',
    })
  })

  it('compressed is false (not undefined) when the flag is empty', () => {
    const uncompressed = SAMPLE_FESREC_OPT.replace(',X,', ',,')
    const { record } = parseFesrecOpt(uncompressed)
    expect(record.compressed).toBe(false)
  })

  it('warns on unexpected field count', () => {
    const { warning } = parseFesrecOpt('a,b')
    expect(warning).toMatch(/expected 20.*got 2/)
  })
})

describe('parseFesrHeaders (merge)', () => {
  it('merges mandatory + optional into one flat record', () => {
    const result = parseFesrHeaders(SAMPLE_FESREC, SAMPLE_FESREC_OPT)
    expect(result.record.rootContextId).toBe('0050568B7A121EE5A8D0C6B7A1234567')
    expect(result.record.appName).toBe('cspquotes')
    expect(result.record.interactionDuration).toBe(1204)
    expect(result.warnings).toEqual([])
  })

  it('returns undefined when the mandatory header is absent', () => {
    expect(parseFesrHeaders(undefined, SAMPLE_FESREC_OPT)).toBeUndefined()
  })

  it('tolerates a missing optional header', () => {
    const result = parseFesrHeaders(SAMPLE_FESREC, undefined)
    expect(result.record.rootContextId).toBe('0050568B7A121EE5A8D0C6B7A1234567')
    expect(result.record.appName).toBeUndefined()
    expect(result.warnings).toEqual([])
  })

  it('sets fesrDirty when either header carries a -1 marker', () => {
    const dirtyOpt = SAMPLE_FESREC_OPT.replace(',1024,', ',-1,')
    const result = parseFesrHeaders(SAMPLE_FESREC, dirtyOpt)
    expect(result.record.fesrDirty).toBe(true)
    expect(result.record.bytesSent).toBe(-1)
  })

  it('collects warnings from both headers when both are malformed', () => {
    const result = parseFesrHeaders('a,b,c', 'x,y')
    expect(result.warnings).toHaveLength(2)
  })
})
