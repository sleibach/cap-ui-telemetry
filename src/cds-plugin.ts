import cds = require('@sap/cds')
import { getConfig } from './lib/config'
import { extendClsCustomFields, ALL_FIELDS } from './lib/custom-fields'
import { createFesrMiddleware } from './lib/fesr-middleware'
import { injectTelemetryServiceModel } from './lib/telemetry-service-model'

const LOG = cds.log('ui-telemetry')

// ── Model injection: the TelemetryService itself ─────────────────────────────
// 'loaded' fires per CSN fragment — injectTelemetryServiceModel is idempotent.
// @ts-expect-error — 'loaded' is a valid CDS event not yet declared in @cap-js/cds-types
cds.on('loaded', (csn: Record<string, unknown>) => {
  const config = getConfig()
  injectTelemetryServiceModel(csn, { ...config.errors, enabled: config.enabled && config.errors.enabled })
})

// ── cls_custom_fields merge + FESR middleware ────────────────────────────────
// Both run in 'bootstrap' — well before any request-time log line can seed the
// JSON formatter's cached custom-fields Set (see custom-fields.ts), and before
// any served service applies cds.middlewares.before (protocols/index.js reads
// cds.middlewares fresh on every srv.serve() call, so 'bootstrap' is early enough).
cds.on('bootstrap', () => {
  const config = getConfig()
  if (!config.enabled) return

  if (config.customFields.extend) extendClsCustomFields(ALL_FIELDS)

  if (config.fesr.enabled) {
    // cds.middlewares.add (not a raw app.use()) mounts this in cds.middlewares.before,
    // which every served service applies at its own path ahead of its protocol adapter —
    // so it still sees $batch, $metadata, actions, this plugin's own error endpoint — and
    // {after: 'auth'} means cds.context.user is already resolved for the optional
    // user-in-debug-log enrichment (see log-user.ts).
    ;(cds as unknown as { middlewares: { add: (mw: unknown, opts: { after: string }) => void } }).middlewares.add(
      createFesrMiddleware(config),
      { after: 'auth' },
    )
  }
})

// ── Startup log ───────────────────────────────────────────────────────────────
cds.once('served', () => {
  const config = getConfig()
  if (!config.enabled) {
    LOG.info('disabled')
    return
  }
  const parts: string[] = []
  if (config.fesr.enabled) parts.push(`FESR → cds.log('${config.fesr.logger}')`)
  if (config.errors.enabled) {
    parts.push(`errors → POST ${config.errors.path}/errors → cds.log('${config.errors.logger}')`)
  }
  LOG.info(`active (${parts.join(', ') || 'nothing enabled'})`)
})
