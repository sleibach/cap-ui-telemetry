import cds = require('@sap/cds')
import type { ErrorsConfig, PluginConfig } from './config'
import { shouldLogUser, resolveUserId } from './log-user'

export interface ClientErrorEntry {
  level?: string
  message?: string
  stackTrace?: string
  errorSource?: string
  appName?: string
  componentName?: string
  url?: string
  userAgent?: string
  timestamp?: string
}

// Only these keys ever reach the log call — matches ERROR_FIELDS in custom-fields.ts
// exactly. Adding a field here without adding it there breaks structured logging
// for the whole record (see custom-fields.ts for why).
export interface ErrorLogRecord {
  errorLevel: 'error' | 'warn' | 'info'
  errorMessage?: string
  stackTrace?: string
  errorSource?: string
  appName?: string
  componentName?: string
  clientUrl?: string
  clientUserAgent?: string
  clientTimestamp?: string
  user?: string
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\r\n\t\x00-\x1f]/g

function sanitizeText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  const cleaned = value.replace(CONTROL_CHARS, ' ')
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned
}

function mapLevel(level: unknown): 'error' | 'warn' | 'info' {
  if (level === 'error') return 'error'
  if (level === 'warning') return 'warn'
  return 'info'
}

/** Whitelist-copies and truncates a raw client entry — never spreads unknown client keys into the log. */
export function toLogRecord(entry: ClientErrorEntry, config: ErrorsConfig): ErrorLogRecord {
  return {
    errorLevel: mapLevel(entry.level),
    errorMessage: sanitizeText(entry.message, config.maxMessageLength),
    stackTrace: sanitizeText(entry.stackTrace, config.maxStackLength),
    errorSource: sanitizeText(entry.errorSource, 32),
    appName: sanitizeText(entry.appName, 70),
    componentName: sanitizeText(entry.componentName, 128),
    clientUrl: sanitizeText(entry.url, 512),
    clientUserAgent: sanitizeText(entry.userAgent, 256),
    clientTimestamp: sanitizeText(entry.timestamp, 32),
  }
}

/** Logs one sanitized client-error entry. Never passes an Error instance — the
 *  formatter has a different (message-merging) code path for those. */
export function logClientError(entry: ClientErrorEntry, config: PluginConfig): void {
  const LOG = cds.log(config.errors.logger)
  const record = toLogRecord(entry, config.errors)

  if (shouldLogUser(config.logUserOn, LOG)) {
    const user = resolveUserId()
    if (user) record.user = user
  }

  const message = record.errorMessage ? `Client error: ${record.errorMessage}` : 'Client error'
  if (record.errorLevel === 'error') LOG.error(message, record)
  else if (record.errorLevel === 'warn') LOG.warn(message, record)
  else LOG.info(message, record)
}
