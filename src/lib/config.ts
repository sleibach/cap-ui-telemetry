import cds = require('@sap/cds')

export interface FesrConfig {
  enabled: boolean
  logger: string
  sampling: number
}

export interface ErrorsConfig {
  enabled: boolean
  logger: string
  path: string
  maxBatchSize: number
  maxMessageLength: number
  maxStackLength: number
}

export interface CustomFieldsConfig {
  extend: boolean
}

/**
 * Attaches cds.context.user.id to a log record once the logger's configured
 * verbosity reaches the given threshold (DEBUG=<category> or cds.env.log.levels
 * raising that specific category) — not the severity of the individual record.
 * 'debug' (default) is the most conservative: only when someone has explicitly
 * turned up verbosity for 'ui-fesr'/'ui-error'. 'never' fully opts out.
 */
export type LogUserOn = 'debug' | 'info' | 'warn' | 'error' | 'never'

export interface PluginConfig {
  enabled: boolean
  fesr: FesrConfig
  errors: ErrorsConfig
  customFields: CustomFieldsConfig
  logUserOn: LogUserOn
}

// Mirrors the defaults shipped in this package's own package.json "cds" section —
// CAP deep-merges those into cds.env already, but callers of this module in isolation
// (unit tests, or code that runs before cds.env is resolved) still get a sane shape.
const DEFAULTS: PluginConfig = {
  enabled: true,
  fesr: { enabled: true, logger: 'ui-fesr', sampling: 1.0 },
  errors: {
    enabled: true,
    logger: 'ui-error',
    path: '/service/telemetry',
    maxBatchSize: 50,
    maxMessageLength: 2048,
    maxStackLength: 8192,
  },
  customFields: { extend: true },
  logUserOn: 'debug',
}

export function getConfig(): PluginConfig {
  const raw = ((cds.env as Record<string, unknown>)['ui-telemetry'] ?? {}) as Partial<PluginConfig>

  return {
    enabled: raw.enabled ?? DEFAULTS.enabled,
    fesr: { ...DEFAULTS.fesr, ...raw.fesr },
    errors: { ...DEFAULTS.errors, ...raw.errors },
    customFields: { ...DEFAULTS.customFields, ...raw.customFields },
    logUserOn: raw.logUserOn ?? DEFAULTS.logUserOn,
  }
}
