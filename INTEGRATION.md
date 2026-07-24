# Integration guide (for coding agents and humans alike)

Goal: wire `cap-ui-telemetry` into an existing CAP + UI5 project. The backend needs zero code changes — installing the package is enough. The frontend needs three small, copy-paste changes. Each step below has a **Verify** you can actually run — do not skip verification, it's how you know a step actually worked before moving to the next.

## Step 0 — Prerequisites

- A CAP Node.js project (`@sap/cds` >= 8.0) with at least one served service.
- A UI5 app (Fiori Elements or freestyle) that bootstraps `sap-ui-core.js`.
- If the app runs behind an approuter: identify the route that proxies to the CAP backend (commonly `^/service/(.*)$` or similar). It must be authenticated and (ideally) CSRF-protected — check the approuter's `xs-app.json`. No approuter change is needed if such a route already exists and its prefix matches `errors.path` (default `/service/telemetry`).

## Step 1 — Install the plugin

```sh
npm add cap-ui-telemetry
```

**Verify:** start the backend (`cds watch` or equivalent). The startup log must include:

```
[ui-telemetry] - active (FESR → cds.log('ui-fesr'), errors → POST /service/telemetry/errors → cds.log('ui-error'))
```

If it says `disabled` instead, check `cds['ui-telemetry'].enabled` in the project's config — something explicitly set it to `false`.

## Shortcut — `cds add ui-telemetry`

Steps 2 and part of Step 4 (enabling the FESR flag, copying the two UI5 snippet files) can be automated:

```sh
npx cds add ui-telemetry
```

If the project has more than one `app/*/webapp/index.html`, the command lists the candidates and asks you to pick one:

```sh
CAP_UI_TELEMETRY_TARGET=app/your-shell npx cds add ui-telemetry
```

(`CAP_UI_TELEMETRY_TARGET`, not a `--target` CLI flag — cds-dk validates CLI options against an allowlist built before third-party plugins are necessarily discovered, so a custom flag here gets rejected as "Invalid option"; the env var sidesteps that entirely.)

This is safe to re-run — it skips files that already exist (pass `--force` to overwrite) and won't duplicate the bootstrap attribute. It does **not** touch `Component.js` — it prints the exact snippet to add (Step 3/4 below) since that file's structure varies too much across projects to patch safely. Continue with Steps 2-4 below either way — they describe exactly what the command just did (or what to do by hand if you skip it).

## Step 2 — Enable FESR in the UI5 bootstrap

Open the app's `index.html` (or the shell's, if there's a launchpad hosting multiple apps) and find the `<script id="sap-ui-bootstrap">` tag. Add one attribute:

```html
data-sap-ui-fesr="true"
```

See [`ui5-snippets/bootstrap-fesr.html`](./ui5-snippets/bootstrap-fesr.html) for a full example. Do **not** add a beacon URL (`data-sap-ui-fesr-beacon-url`) — that switches UI5 to `sendBeacon` mode, which this plugin does not listen on; the piggyback (header) approach is what's parsed.

**Verify:** open the app in a browser, open DevTools → Network, click around (any interaction: navigate, filter a list, open an object page). Inspect the headers of the *next* backend XHR request after the click — it should carry `SAP-Perf-FESRec` and `SAP-Perf-FESRec-opt`. If you don't want to wait for a rebuild/redeploy to test this, append `?sap-ui-fesr=true` to the URL for an ad-hoc check first.

Then check the backend log for a line like:

```
[ui-fesr] - FESR interaction { appName: '...', stepName: '...', interactionDuration: 1204, ... }
```

## Step 3 — (Optional but recommended) Enrich FESR with the active app's name

Skip this step for a single standalone app — UI5's own component-derived name is already fine. Do this step if a shell hosts multiple embedded apps (Fiori Elements apps opened in-place via `Component.create`, not iframes) and you want dashboards grouped by the app the *user* thinks they're in, not the triggering component's technical id.

1. Copy [`ui5-snippets/fesr-enrichment.js`](./ui5-snippets/fesr-enrichment.js) into the shell, e.g. `webapp/telemetry/FesrEnrichment.js`.
2. Open it and adjust `resolveActiveApp()`'s **Variant 1** to match how your shell tracks the open app (a JSON model property, a global, a router target name — whatever it already uses). If the shell is `sap.ushell`-based instead of a custom launchpad, use the commented-out **Variant 2** instead.
3. In the shell's `Component.init()`, call it once, early:
   ```js
   sap.ui.require(["your/shell/telemetry/FesrEnrichment"], function (FesrEnrichment) {
     FesrEnrichment.register();
   });
   ```

**Verify:** repeat Step 2's browser check, but confirm `appName` in the logged FESR record now matches the *currently open app's* id, not just the component that happened to trigger the last interaction — switch to a different embedded app and click again; `appName` must change accordingly.

## Step 4 — Add client-error reporting

1. Copy [`ui5-snippets/ErrorReporter.js`](./ui5-snippets/ErrorReporter.js) into the app/shell, e.g. `webapp/telemetry/ErrorReporter.js`.
2. Start it once, early (shell `Component.init()`, or the standalone app's `Component.init()` if there's no shell):
   ```js
   sap.ui.require(["your/app/telemetry/ErrorReporter"], function (ErrorReporter) {
     new ErrorReporter().start();
     // If /service/telemetry isn't reachable at the default path, override it:
     // new ErrorReporter({ endpoint: "/your/service/telemetry/errors" }).start();
   });
   ```

**Verify:**
- In the browser console, run `throw new Error('cap-ui-telemetry-integration-test')`.
- Wait up to `flushInterval` (default 10s), or trigger a page navigation/close to force an immediate flush.
- Check the backend log for:
  ```
  [ui-error] - Client error: cap-ui-telemetry-integration-test { errorLevel: 'error', errorSource: 'window-error', ... }
  ```
- Also try `sap.base.Log?.error?.('cap-ui-telemetry-log-test')` (or however `sap/base/Log` is available in that app) to confirm the `Log.addLogListener` path works too, distinct from the `window.onerror` path.

## Step 5 — Approuter / auth checklist

The errors endpoint (`POST <errors.path>/errors`, default `/service/telemetry/errors`) is served with `@requires: 'authenticated-user'`. Confirm:

- The approuter route covering `errors.path` requires authentication (it almost certainly already does, if it's the same route your OData/REST services go through).
- If that route has `csrfProtection: true` (recommended), no further change is needed — `ErrorReporter.js` already does the `HEAD` + `X-CSRF-Token: Fetch` dance and retries once on a `403`.
- If the endpoint must be reachable by fully anonymous/unauthenticated users, relax it explicitly (see README's Configuration reference for the `annotate ... with @requires: 'any'` snippet) — do this deliberately, not as a troubleshooting shortcut.

**Verify:** the `throw new Error(...)` check from Step 4 should have returned a `2xx` in the Network tab, not `401`/`403`/`404`. If it's `404`, `errors.path` likely doesn't match anything the approuter proxies to the CAP backend — check `errors.path` config against the approuter's routes.

## Step 6 — Cloud Logging verification (once deployed)

Once this is live on a landscape with SAP Cloud Logging bound:

- Query `logger: "ui-fesr"` — confirm records are arriving with `appName`, `interactionDuration`, etc. as their own filterable fields (not buried inside a `msg` string — if they are, see the README's Cloud Logging notes on the `cls_custom_fields` all-or-nothing rule).
- Query `logger: "ui-error"` — same check for client errors.
- Try an exact-match lookup on a `rootContextId` or `fesrTransactionId` value from a record you just produced — confirms trace correlation works.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| No `SAP-Perf-FESRec` header ever appears | `data-sap-ui-fesr="true"` typo, or the page is served from a cached build without the bootstrap change — hard-refresh / check the deployed `index.html` matches source |
| FESR records appear but `appName` never changes across apps | Step 3 enrichment not registered, or registered *after* the first interaction already completed |
| `POST /service/telemetry/errors` → `403` | CSRF token issue — confirm the approuter route has `csrfProtection: true` and that `ErrorReporter.js`'s `csrfEndpoint` (service root) actually responds to `HEAD` |
| `POST /service/telemetry/errors` → `404` | `errors.path` config doesn't match any approuter-proxied route, or `errors.enabled` is `false` |
| Plugin fields show up inside `msg` as an inspected object instead of their own JSON properties | `customFields.extend` is `false`, or something else replaced (rather than merged into) `cds.env.log.cls_custom_fields` after this plugin ran |
| Startup log says the plugin is `disabled` | `cds['ui-telemetry'].enabled` is explicitly `false` somewhere in the project's config/profiles |
