import cds = require('@sap/cds')
import type { Request, Response, NextFunction } from 'express'
import { parseFesrHeaders } from './fesr-parser'
import type { PluginConfig } from './config'
import { shouldLogUser, resolveUserId } from './log-user'

function headerValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

/**
 * Reads the SAP-Perf-FESRec(-opt) headers UI5 piggybacks onto the next backend
 * request after each completed interaction (when data-sap-ui-fesr="true") and
 * emits one structured cds.log record per interaction.
 *
 * Registered via cds.middlewares.add(mw, {after: 'auth'}) (see cds-plugin.ts) —
 * that runs it before every served CDS service's own protocol adapter (so it
 * sees $batch, $metadata, actions, this plugin's own error endpoint, ...), and
 * after CAP's own auth middleware, so cds.context.user is already resolved.
 *
 * Never breaks the request: parsing/logging errors are swallowed and logged
 * to the 'ui-telemetry' diagnostic category; next() always fires exactly once.
 */
export function createFesrMiddleware(config: PluginConfig) {
  const LOG = cds.log(config.fesr.logger)
  const DIAG = cds.log('ui-telemetry')

  return function fesrMiddleware(req: Request, _res: Response, next: NextFunction): void {
    try {
      if (config.fesr.enabled) {
        const fesrec = headerValue(req.headers['sap-perf-fesrec'] as string | string[] | undefined)
        if (fesrec && (config.fesr.sampling >= 1 || Math.random() < config.fesr.sampling)) {
          const fesrecOpt = headerValue(req.headers['sap-perf-fesrec-opt'] as string | string[] | undefined)
          const parsed = parseFesrHeaders(fesrec, fesrecOpt)
          if (parsed) {
            for (const warning of parsed.warnings) DIAG.debug(warning)
            if (shouldLogUser(config.logUserOn, LOG)) {
              const user = resolveUserId()
              if (user) parsed.record.user = user
            }
            LOG.info('FESR interaction', parsed.record)
          }
        }
      }
    } catch (err) {
      DIAG.error('Failed to process FESR headers', err)
    }
    next()
  }
}
