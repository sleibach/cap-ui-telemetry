# cap-ui-telemetry

[![npm version](https://img.shields.io/npm/v/cap-ui-telemetry.svg)](https://www.npmjs.com/package/cap-ui-telemetry)

UI5 FESR (frontend performance) + client-error capture for SAP CAP (Node.js), forwarded to SAP Cloud Logging via `cds.log`.

Built for landscapes that run SAP Cloud Logging but have **no Cloud ALM** — official FESR targets CALM RUM, which has nowhere to land without it. This plugin uses Cloud Logging as a **primary sink** for both signals instead: UI5's piggybacked FESR headers, and client-side JS errors.

## Features

- **FESR capture** — reads the `SAP-Perf-FESRec` / `SAP-Perf-FESRec-opt` headers UI5 piggybacks onto the next backend request after each completed interaction (when `sap-ui-fesr=true`), parses them, and emits one structured `cds.log('ui-fesr')` record per interaction.
- **Client-error ingestion** — a CDS REST service (`POST <path>/errors`) accepts batches of client errors and emits one `cds.log('ui-error')` record per entry.
- **Cloud-Logging-ready by construction** — automatically extends `cds.env.log.cls_custom_fields` so every field (app name, step name, durations, error message, ...) lands as a flat, filterable/aggregatable field, not buried in free text.
- **No database** — pure logging, nothing persisted by this plugin.
- **Zero backend wiring** — install it and it's active; the only integration work is on the frontend (three copy-paste snippets, see below).
- **Optional user attribution on demand** — `cds.context.user.id` gets attached to a record once you raise that logger's verbosity (`DEBUG=ui-fesr` / `DEBUG=ui-error`), config-gated and off by default in normal operation.

## Requirements

- `@sap/cds` >= 8.0 (Node.js)
- A UI5 app (any version with `sap/ui/performance/trace/FESR` and `sap/base/Log` — i.e., any reasonably recent UI5)
- SAP Cloud Logging bound to your CAP app for the custom fields to be indexed (works locally without it too — see [Cloud Logging notes](#cloud-logging-notes))

## Install

```sh
npm add cap-ui-telemetry
```

That's it for the backend — no code changes required. CAP auto-discovers the plugin via `cds-plugin.js`.

## Setup

**Backend:** nothing to do. On next `cds watch` / `cds-serve` you'll see:

```
[ui-telemetry] - active (FESR → cds.log('ui-fesr'), errors → POST /service/telemetry/errors → cds.log('ui-error'))
```

**Frontend:** copy three files from [`ui5-snippets/`](./ui5-snippets) into your app and wire them up — see **[INTEGRATION.md](./INTEGRATION.md)** for numbered, verifiable steps (written so a coding agent can follow them unattended). `npx cds add ui-telemetry` automates the bootstrap flag + file-copy part of this (see INTEGRATION.md's Shortcut section). Summary:

1. [`bootstrap-fesr.html`](./ui5-snippets/bootstrap-fesr.html) — add `data-sap-ui-fesr="true"` to your bootstrap tag.
2. [`fesr-enrichment.js`](./ui5-snippets/fesr-enrichment.js) — optional, enriches FESR records with "which app is open" for shells hosting multiple apps.
3. [`ErrorReporter.js`](./ui5-snippets/ErrorReporter.js) — captures `sap/base/Log` errors/warnings, uncaught exceptions, and unhandled promise rejections, and POSTs them (batched, CSRF-protected, rate-limited) to the backend. Pass `appName` (a static string, or a resolver function for shells) so `ui-error` records correlate with the same app identity as `ui-fesr` records.

## Configuration reference

Set under a top-level `cds['ui-telemetry']` key (package.json, `.cdsrc.json`, or any CAP profile) — **not** under `cds.requires`, since nothing ever `cds.connect.to`'s this plugin.

| Key | Default | Description |
|---|---|---|
| `enabled` | `true` | Master switch. `false` disables everything (FESR middleware, errors service, custom-fields merge). |
| `fesr.enabled` | `true` | Enable/disable FESR header capture independently. |
| `fesr.logger` | `'ui-fesr'` | `cds.log(...)` category for FESR records. |
| `fesr.sampling` | `1.0` | Fraction of interactions to log (`0`–`1`). Useful to cut volume in production (e.g. `0.25`). |
| `errors.enabled` | `true` | Enable/disable the client-error ingestion service independently. |
| `errors.logger` | `'ui-error'` | `cds.log(...)` category for client-error records. |
| `errors.path` | `'/service/telemetry'` | Service base path — action is served at `<path>/errors`. Change this if `/service/*` is already taken. |
| `errors.maxBatchSize` | `50` | Reject (`400`) a batch with more entries than this. |
| `errors.maxMessageLength` | `2048` | Truncate `message` beyond this length (never rejects). |
| `errors.maxStackLength` | `8192` | Truncate `stackTrace` beyond this length (never rejects). |
| `customFields.extend` | `true` | Auto-merge this plugin's fields into `cds.env.log.cls_custom_fields`. Set `false` to manage that list yourself. |
| `logUserOn` | `'debug'` | One of `'debug' \| 'info' \| 'warn' \| 'error' \| 'never'` — attach `cds.context.user.id` to a record once that *logger's* configured verbosity reaches this threshold (e.g. `DEBUG=ui-fesr`). `'never'` fully opts out. See [Log record reference](#log-record-reference). |

Example: sample 25% of FESR records and silence errors reporting in production only:

```jsonc
{
  "cds": {
    "ui-telemetry": {
      "fesr": { "sampling": 1.0 },
      "[production]": { "fesr": { "sampling": 0.25 } }
    }
  }
}
```

Example: relax auth on the errors endpoint for a fully anonymous UI (not recommended unless the route is otherwise protected):

```cds
using { TelemetryService } from 'cap-ui-telemetry/lib/telemetry-service';
annotate TelemetryService with @requires: 'any';
```

## Log record reference

Every field listed here is registered in `cds.env.log.cls_custom_fields` (see [Cloud Logging notes](#cloud-logging-notes) for why that matters). Numeric fields are emitted as actual numbers, not strings — required for percentile/avg aggregations.

### `ui-fesr` records

| Field | Type | Source (`SAP-Perf-FESRec[-opt]` position) |
|---|---|---|
| `rootContextId` | string | mandatory #0 |
| `fesrTransactionId` | string | mandatory #1 |
| `clientNavigationTime` | number (ms) | mandatory #2 |
| `clientRoundTripTime` | number (ms) | mandatory #3 |
| `interactionDuration` | number (ms) | mandatory #4 — UI5's Time To Interactive |
| `completedRoundTrips` | number | mandatory #5 |
| `passportAction` | string | mandatory #6 — `<trigger>_<event>_<stepCounter>` |
| `networkTime` | number (ms) | mandatory #7 |
| `requestTime` | number (ms) | mandatory #8 |
| `clientOS` | string | mandatory #9 |
| `appName` | string | optional #0 (UI5's `appNameShort`) |
| `stepName` | string | optional #1 |
| `clientModel` | string | optional #3 — browser + version |
| `bytesSent` / `bytesReceived` | number | optional #4/#5 |
| `clientProcessingTime` | number (ms) | optional #8 |
| `compressed` | boolean | optional #9 |
| `busyDuration` | number (ms) | optional #14 |
| `interactionType` | number | optional #15 — `0` n/a, `1` app start, `2` follow-up step, `3` unknown |
| `clientDevice` | number | optional #16 — `0` unknown, `1` combi, `2` desktop, `3` phone, `4` tablet |
| `legacyDuration` | number (ms) | optional #17 |
| `interactionStartTime` | string | optional #18 — digits-only ISO timestamp |
| `appNameLong` | string | optional #19 |
| `fesrDirty` | boolean | present only if any numeric field carried UI5's own "-1 = dirty" marker |
| `user` | string | `cds.context.user.id`, only when `logUserOn`'s threshold is met |

### `ui-error` records

| Field | Type | Notes |
|---|---|---|
| `errorLevel` | `'error' \| 'warn' \| 'info'` | mapped from the client's `level` (`'error'`→error, `'warning'`→warn, anything else→info) |
| `errorMessage` | string | truncated to `errors.maxMessageLength` |
| `stackTrace` | string | truncated to `errors.maxStackLength` |
| `errorSource` | string | `'ui5-log' \| 'window-error' \| 'unhandledrejection'` |
| `appName` | string | shared name with `ui-fesr` records — correlate errors to performance by app |
| `componentName` | string | UI5 log component, when available |
| `clientUrl` | string | page URL at the time of the error |
| `clientUserAgent` | string | `navigator.userAgent` |
| `clientTimestamp` | string | client-supplied ISO timestamp |
| `user` | string | `cds.context.user.id`, only when `logUserOn`'s threshold is met |

## Cloud Logging notes

`cls_custom_fields` is **not** an indexing switch — OpenSearch (Cloud Logging's backing store) dynamically indexes any top-level JSON field regardless. What it actually gates is whether an **object argument** passed to a log call (`cds.log(id).info(msg, {...})`) gets flattened into top-level fields at all, or falls through as an unstructured, `util.inspect`-style blob inside `msg`.

That gate is **all-or-nothing per object**: if even one key in the object isn't registered, the *entire* object degrades to text — not "some fields indexed, some not." That's why this plugin auto-registers every field it ever emits (`customFields.extend`, on by default) — and why, if you ever see plugin fields showing up inside `msg` instead of as their own JSON properties, the first thing to check is whether `customFields.extend` got turned off, or whether `cls_custom_fields` was replaced (not merged) by some other config.

Useful OpenSearch queries once records are flowing:

- `logger: "ui-fesr" AND appName: "your-app-id"` — all performance records for one app
- p95/avg of `interactionDuration`, faceted by `appName` + `stepName` — per-app, per-action performance dashboards
- `logger: "ui-error" AND errorLevel: "error"` — error rate, faceted by `appName`
- `rootContextId: "<id>"` or `fesrTransactionId: "<id>"` — exact-match trace correlation across records

Locally, without a Cloud Logging binding, the plain-text formatter is used and none of this matters — log lines are just readable text, no config needed.

## Development and testing

```sh
npm install
npm run build   # tsc → dist/
npm test        # build + jest --runInBand (unit + integration, test/app workspace)
```

- `test/unit` — pure logic: FESR header parsing, custom-fields merge mechanics, client-error sanitization, user-attachment gating, CSN model injection.
- `test/integration` — boots the `test/app` sample CAP project (via `@cap-js/cds-test`) and exercises the FESR middleware and the errors service end to end over real HTTP.

## License

Apache-2.0
