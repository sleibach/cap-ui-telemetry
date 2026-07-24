import cds = require('@sap/cds')
import type { LogUserOn } from './config'

interface LevelFlags {
  _debug?: boolean
  _info?: boolean
  _warn?: boolean
  _error?: boolean
}

/**
 * Whether to attach cds.context.user.id to a record, based on the *logger's*
 * configured verbosity (DEBUG=<category> env var, or cds.env.log.levels for
 * that category) — not the severity of the individual record being logged.
 * Levels are monotonic (TRACE > DEBUG > INFO > WARN > ERROR), so 'debug' is
 * the most conservative (only once someone explicitly raised verbosity for
 * this category) and 'error' the least (true unless the category is silenced).
 */
export function shouldLogUser(setting: LogUserOn, logger: LevelFlags): boolean {
  switch (setting) {
    case 'never':
      return false
    case 'error':
      return !!logger._error
    case 'warn':
      return !!logger._warn
    case 'info':
      return !!logger._info
    case 'debug':
      return !!logger._debug
    default:
      return false
  }
}

/** The id of the user affected by the current request, if any is established. */
export function resolveUserId(): string | undefined {
  return cds.context?.user?.id
}
