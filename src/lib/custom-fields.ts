import cds = require('@sap/cds')

// Single source of truth for every key fesr-middleware.ts / error-log.ts ever
// put into a log object. CAP's JSON formatter extracts a log call's object
// argument into flat top-level fields only if EVERY key in that object is
// registered here (all-or-nothing per object — see @sap/cds/lib/log/format/json.js
// _is_custom_fields). Miss a field here and the *entire* record silently
// degrades into an unstructured, util.inspect-style blob inside `msg`.
export const FESR_FIELDS: string[] = [
  'rootContextId',
  'fesrTransactionId',
  'clientNavigationTime',
  'clientRoundTripTime',
  'interactionDuration',
  'completedRoundTrips',
  'passportAction',
  'networkTime',
  'requestTime',
  'clientOS',
  'appName',
  'stepName',
  'clientModel',
  'bytesSent',
  'bytesReceived',
  'clientProcessingTime',
  'compressed',
  'busyDuration',
  'interactionType',
  'clientDevice',
  'legacyDuration',
  'interactionStartTime',
  'appNameLong',
  'fesrDirty',
  'user', // cds.context.user.id — only attached when logUserOn's threshold is met, see log-user.ts
]

export const ERROR_FIELDS: string[] = [
  'errorLevel',
  'errorMessage',
  'stackTrace',
  'errorSource',
  'appName', // shared with FESR_FIELDS — lets both loggers be correlated by app
  'componentName',
  'clientUrl',
  'clientUserAgent',
  'clientTimestamp',
  'user',
]

export const ALL_FIELDS: string[] = [...new Set([...FESR_FIELDS, ...ERROR_FIELDS])]

/**
 * Union-merges the given field names into cds.env.log.cls_custom_fields —
 * mutates in place so CAP's own defaults (query, target, details, reason) and
 * any host-added fields survive. Must run at plugin load time, before any
 * request-time log line seeds the JSON formatter's cached custom-fields Set.
 */
export function extendClsCustomFields(fields: string[] = ALL_FIELDS): void {
  const log = cds.env.log as Record<string, unknown>
  const existing = log.cls_custom_fields as string[] | undefined

  if (!Array.isArray(existing)) {
    log.cls_custom_fields = [...fields]
    return
  }
  for (const field of fields) {
    if (!existing.includes(field)) existing.push(field)
  }
}
