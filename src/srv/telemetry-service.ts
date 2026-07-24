import cds = require('@sap/cds')
import { getConfig } from '../lib/config'
import { logClientError } from '../lib/error-log'
import type { ClientErrorEntry } from '../lib/error-log'

const DIAG = cds.log('ui-telemetry')

// Plain CAP service-impl function — CAP calls this bound to the service
// instance (`this` === srv), the standard idiom for a simple @impl target.
async function TelemetryServiceImpl(this: cds.Service): Promise<void> {
  this.on('errors', async (req: cds.Request) => {
    const config = getConfig()
    const entries = (req.data.entries ?? []) as ClientErrorEntry[]

    if (entries.length > config.errors.maxBatchSize) {
      req.reject(400, `Too many entries in one batch — max ${config.errors.maxBatchSize}`)
      return
    }

    let accepted = 0
    for (const entry of entries) {
      try {
        logClientError(entry, config)
        accepted++
      } catch (err) {
        // A broken entry must not fail the whole batch, and must not log back
        // through 'ui-error' — that would ping-pong client errors with server errors.
        DIAG.error('Failed to log a client error entry', err)
      }
    }
    return { accepted }
  })
}

export = TelemetryServiceImpl
