// Pure parsing of UI5's piggyback FESR headers. No cds/express dependency —
// keeps this testable with plain sample header strings and safe to reuse
// anywhere (e.g. a future non-CAP consumer).
//
// Field layout verified against UI5's sap/ui/performance/trace/FESR.js
// (createFESR / createFESRopt). Values are never comma-containing (UI5's own
// format() truncates strings and rejects out-of-range/negative numbers to "-1"),
// so a plain split(',') by fixed index is safe.

const MANDATORY_FIELD_COUNT = 11
const OPTIONAL_FIELD_COUNT = 20

export interface FesrMandatoryRecord {
  rootContextId?: string
  fesrTransactionId?: string
  clientNavigationTime?: number
  clientRoundTripTime?: number
  interactionDuration?: number
  completedRoundTrips?: number
  passportAction?: string
  networkTime?: number
  requestTime?: number
  clientOS?: string
}

export interface FesrOptionalRecord {
  appName?: string
  stepName?: string
  clientModel?: string
  bytesSent?: number
  bytesReceived?: number
  clientProcessingTime?: number
  compressed?: boolean
  busyDuration?: number
  interactionType?: number
  clientDevice?: number
  legacyDuration?: number
  interactionStartTime?: string
  appNameLong?: string
}

export type FesrRecord = FesrMandatoryRecord & FesrOptionalRecord & { fesrDirty?: boolean; user?: string }

export interface ParseResult<T> {
  record: T
  /** true if any numeric field carried UI5's "-1" dirty marker (negative or out-of-range at capture time) */
  dirty: boolean
  /** set when the header didn't split into the expected number of fields — anomaly, not fatal */
  warning?: string
}

function toStringOrUndefined(raw: string | undefined): string | undefined {
  return raw === undefined || raw === '' ? undefined : raw
}

function toNumberOrUndefined(raw: string | undefined): { value?: number; dirty: boolean } {
  if (raw === undefined || raw === '') return { dirty: false }
  const n = Number(raw)
  if (Number.isNaN(n)) return { dirty: false }
  return { value: n, dirty: n === -1 }
}

/** Parses the mandatory `SAP-Perf-FESRec` header (11 positional comma-separated fields). */
export function parseFesrec(header: string): ParseResult<FesrMandatoryRecord> {
  const f = header.split(',')
  let dirty = false
  const take = (i: number) => {
    const r = toNumberOrUndefined(f[i])
    dirty = dirty || r.dirty
    return r.value
  }

  const record: FesrMandatoryRecord = {
    rootContextId: toStringOrUndefined(f[0]),
    fesrTransactionId: toStringOrUndefined(f[1]),
    clientNavigationTime: take(2),
    clientRoundTripTime: take(3),
    interactionDuration: take(4),
    completedRoundTrips: take(5),
    passportAction: toStringOrUndefined(f[6]),
    networkTime: take(7),
    requestTime: take(8),
    clientOS: toStringOrUndefined(f[9]),
    // f[10] (clientType) is always the constant "SAP_UI5" — no filtering value, dropped
  }

  const warning =
    f.length === MANDATORY_FIELD_COUNT
      ? undefined
      : `SAP-Perf-FESRec: expected ${MANDATORY_FIELD_COUNT} comma-separated fields, got ${f.length}`

  return { record, dirty, warning }
}

/** Parses the optional `SAP-Perf-FESRec-opt` header (20 positional comma-separated fields). */
export function parseFesrecOpt(header: string): ParseResult<FesrOptionalRecord> {
  const f = header.split(',')
  let dirty = false
  const take = (i: number) => {
    const r = toNumberOrUndefined(f[i])
    dirty = dirty || r.dirty
    return r.value
  }

  const record: FesrOptionalRecord = {
    appName: toStringOrUndefined(f[0]), // UI5's appNameShort
    stepName: toStringOrUndefined(f[1]),
    // f[2] not assigned
    clientModel: toStringOrUndefined(f[3]),
    bytesSent: take(4),
    bytesReceived: take(5),
    // f[6], f[7] network protocol/provider — UI5 never populates these
    clientProcessingTime: take(8),
    compressed: f[9] === 'X',
    // f[10]..f[13] not assigned / persistency (ABAP/HANA-only, UI5 always sends "")
    busyDuration: take(14),
    interactionType: take(15), // 0 n/a, 1 app start, 2 follow-up step, 3 unknown
    clientDevice: take(16), // 0 unknown, 1 combi, 2 desktop, 3 phone, 4 tablet
    legacyDuration: take(17),
    interactionStartTime: toStringOrUndefined(f[18]), // digits-only ISO timestamp
    appNameLong: toStringOrUndefined(f[19]),
  }

  const warning =
    f.length === OPTIONAL_FIELD_COUNT
      ? undefined
      : `SAP-Perf-FESRec-opt: expected ${OPTIONAL_FIELD_COUNT} comma-separated fields, got ${f.length}`

  return { record, dirty, warning }
}

export interface FesrParseResult {
  record: FesrRecord
  warnings: string[]
}

/** Parses both piggyback headers and merges them into one flat record. `fesrec` absent → no FESR record at all. */
export function parseFesrHeaders(fesrec: string | undefined, fesrecOpt: string | undefined): FesrParseResult | undefined {
  if (!fesrec) return undefined

  const mandatory = parseFesrec(fesrec)
  const optional = fesrecOpt ? parseFesrecOpt(fesrecOpt) : undefined

  const record: FesrRecord = { ...mandatory.record, ...optional?.record }
  if (mandatory.dirty || optional?.dirty) record.fesrDirty = true

  const warnings = [mandatory.warning, optional?.warning].filter((w): w is string => !!w)
  return { record, warnings }
}
