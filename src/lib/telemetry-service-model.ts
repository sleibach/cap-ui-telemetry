import type { ErrorsConfig } from './config'

// A plugin's own package.json "cds.models" entry is NOT consulted by the
// runtime model resolver — @sap/cds/lib/compile/resolve.js only ever reads
// cds.env.roots and cds.requires[x].model, never a plain "models" key. So a
// real .cds file shipped by a dependency is never auto-compiled into the
// host's model. lib/telemetry-service.cds exists purely as a human-readable
// reference of the shape below (kept in sync manually) — the actual runtime
// definition is synthesized here, the same technique cap-oauth2 uses for its
// Tokens entity (cds.on('loaded', csn => ...)).
const SERVICE_FQN = 'cap.ui.telemetry.TelemetryService'
const ENTRY_TYPE_FQN = `${SERVICE_FQN}.ClientErrorEntry`
const ERRORS_ACTION_FQN = `${SERVICE_FQN}.errors`

/**
 * Injects the TelemetryService (+ its ClientErrorEntry type and errors action)
 * into a loaded CSN fragment. 'loaded' fires per fragment — idempotent (checks
 * SERVICE_FQN first). No-ops entirely when disabled — nothing to remove since
 * it's never part of a real root model file to begin with.
 */
export function injectTelemetryServiceModel(csn: Record<string, unknown>, config: ErrorsConfig): void {
  if (!config.enabled) return

  const definitions = csn.definitions as Record<string, unknown> | undefined
  if (!definitions) return
  if (definitions[SERVICE_FQN]) return // already injected into an earlier fragment

  definitions[SERVICE_FQN] = {
    kind: 'service',
    '@protocol': 'rest',
    '@path': config.path,
    '@requires': 'authenticated-user',
    '@impl': 'cap-ui-telemetry/dist/srv/telemetry-service',
  }

  // Unbounded on purpose: CAP's REST protocol adapter enforces cds.String(n)
  // length at the input-validation layer and rejects the whole request (400)
  // before our handler ever runs — which would fight the "truncate, never
  // reject" design of error-log.ts's sanitizeText(). cds.LargeString has no
  // declared length, so truncation to config.maxMessageLength/maxStackLength
  // (and the fixed limits for the other fields) is enforced exactly once, in
  // error-log.ts, not duplicated (and contradicted) at the model layer.
  definitions[ENTRY_TYPE_FQN] = {
    kind: 'type',
    elements: {
      level: { type: 'cds.LargeString' },
      message: { type: 'cds.LargeString' },
      stackTrace: { type: 'cds.LargeString' },
      errorSource: { type: 'cds.LargeString' },
      appName: { type: 'cds.LargeString' },
      componentName: { type: 'cds.LargeString' },
      url: { type: 'cds.LargeString' },
      userAgent: { type: 'cds.LargeString' },
      timestamp: { type: 'cds.LargeString' },
    },
  }

  definitions[ERRORS_ACTION_FQN] = {
    kind: 'action',
    params: {
      entries: { items: { type: ENTRY_TYPE_FQN } },
    },
    returns: {
      elements: { accepted: { type: 'cds.Integer' } },
    },
  }
}
