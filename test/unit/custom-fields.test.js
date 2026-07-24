'use strict'

jest.mock('@sap/cds', () => ({ env: { log: {} } }))
const cds = require('@sap/cds')
const { FESR_FIELDS, ERROR_FIELDS, ALL_FIELDS, extendClsCustomFields } = require('../../dist/lib/custom-fields')

beforeEach(() => {
  cds.env.log = {}
})

describe('ALL_FIELDS', () => {
  it('is the deduplicated union of FESR_FIELDS and ERROR_FIELDS', () => {
    expect(ALL_FIELDS).toEqual([...new Set([...FESR_FIELDS, ...ERROR_FIELDS])])
    // appName is intentionally shared between both loggers
    expect(FESR_FIELDS).toContain('appName')
    expect(ERROR_FIELDS).toContain('appName')
    expect(ALL_FIELDS.filter((f) => f === 'appName')).toHaveLength(1)
  })
})

describe('extendClsCustomFields', () => {
  it('initializes cls_custom_fields when absent', () => {
    delete cds.env.log.cls_custom_fields
    extendClsCustomFields(['a', 'b'])
    expect(cds.env.log.cls_custom_fields).toEqual(['a', 'b'])
  })

  it('preserves CAP defaults and host-added fields, appending only new ones', () => {
    cds.env.log.cls_custom_fields = ['query', 'target', 'details', 'reason', 'hostField']
    extendClsCustomFields(['appName', 'errorMessage'])
    expect(cds.env.log.cls_custom_fields).toEqual([
      'query',
      'target',
      'details',
      'reason',
      'hostField',
      'appName',
      'errorMessage',
    ])
  })

  it('does not duplicate fields already present', () => {
    cds.env.log.cls_custom_fields = ['query', 'appName']
    extendClsCustomFields(['appName', 'stepName'])
    expect(cds.env.log.cls_custom_fields).toEqual(['query', 'appName', 'stepName'])
  })

  it('is idempotent across repeated calls', () => {
    cds.env.log.cls_custom_fields = ['query']
    extendClsCustomFields(['appName'])
    extendClsCustomFields(['appName'])
    expect(cds.env.log.cls_custom_fields).toEqual(['query', 'appName'])
  })

  it('defaults to the full ALL_FIELDS union when called without arguments', () => {
    cds.env.log.cls_custom_fields = []
    extendClsCustomFields()
    expect(cds.env.log.cls_custom_fields).toEqual(ALL_FIELDS)
  })
})
