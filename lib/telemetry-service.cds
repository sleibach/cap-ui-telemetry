namespace cap.ui.telemetry;

// REFERENCE ONLY — not auto-loaded. CAP's runtime model resolver never reads a
// plain "cds.models" package.json key (only cds.env.roots / cds.requires[x].model),
// so this file is not compiled into a host project just by installing the plugin.
// The actual TelemetryService is synthesized at runtime from
// src/lib/telemetry-service-model.ts (cds.on('loaded')) — keep this file in sync
// by hand; it exists so the shape is easy to read and to `using` explicitly if
// an integrator prefers a real model file (see README).
//
// Client error ingestion. Batched, unbound action — no entities, no persistence.
// @path reflects the default cds['ui-telemetry'].errors.path; the injected
// version is patched per-config (see telemetry-service-model.ts).
@protocol: 'rest'
@path    : '/service/telemetry'
@requires: 'authenticated-user'
@impl    : 'cap-ui-telemetry/dist/srv/telemetry-service'
service TelemetryService {

  // Unbounded on purpose — CAP's REST protocol would otherwise reject an
  // oversized value outright (400) before error-log.ts gets a chance to
  // truncate it. Truncation to config.maxMessageLength/maxStackLength (and
  // fixed limits for the rest) is enforced exactly once, in error-log.ts.
  type ClientErrorEntry {
    level        : LargeString;   // 'error' | 'warning' | anything else maps to info
    message      : LargeString;
    stackTrace   : LargeString;
    errorSource  : LargeString;   // 'ui5-log' | 'window-error' | 'unhandledrejection'
    appName      : LargeString;
    componentName: LargeString;
    url          : LargeString;
    userAgent    : LargeString;
    timestamp    : LargeString;   // client-supplied ISO timestamp
  }

  action errors(entries: many ClientErrorEntry) returns { accepted: Integer };
}
