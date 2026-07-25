/*
 * cap-ui-telemetry — Step 3: capture client errors and report them to the backend.
 *
 * Copy this file into your app (e.g. webapp/telemetry/ErrorReporter.js) and
 * start it once, early — e.g. in the shell's Component.init():
 *
 *   sap.ui.require(["your/app/telemetry/ErrorReporter"], function (ErrorReporter) {
 *     // Standalone app: pass its own known namespace/manifest id.
 *     new ErrorReporter({ appName: "yourAppNamespace" }).start();
 *     // Shell hosting several embedded apps: pass a resolver instead, matching
 *     // whatever fesr-enrichment.js's resolveActiveApp() reads for FESR records.
 *     // new ErrorReporter({ appName: function () { return sessionStorage.getItem("my.app"); } }).start();
 *   });
 *
 * Sources captured:
 *  - sap/base/Log entries at ERROR/WARNING/FATAL level (Log.addLogListener)
 *  - uncaught exceptions (window 'error')
 *  - unhandled promise rejections (window 'unhandledrejection')
 *
 * Safety by design:
 *  - Loop guard: entries logged by this module itself (OWN_COMPONENT) are
 *    never re-reported, and a failed send is only ever console.debug'd, never
 *    Log.error'd/warn'd — both would otherwise re-enter the listener above.
 *  - Circuit breaker: after maxConsecutiveFailures, reporting pauses instead
 *    of retrying every entry against a backend that's clearly unreachable.
 *  - Batched + rate-limited: entries queue up and flush periodically (not one
 *    request per error), with a hard cap on queue size (oldest dropped first)
 *    and a per-minute send-count ceiling.
 *  - Flushes on page hide (tab close/navigate away) via a keepalive fetch —
 *    NOT navigator.sendBeacon, because sendBeacon cannot set the CSRF header
 *    the approuter requires; a keepalive fetch can and does survive unload.
 */
sap.ui.define(["sap/base/Log"], function (Log) {
  "use strict";

  var OWN_COMPONENT = "cap.ui.telemetry.ErrorReporter";

  var DEFAULTS = {
    endpoint: "/service/telemetry/errors",
    // Where to fetch the CSRF token from (HEAD + X-CSRF-Token: Fetch). Defaults
    // to the service root (one path segment up from `endpoint`) since an
    // unbound-action path is typically POST-only and may not answer HEAD.
    csrfEndpoint: null,
    // "Which app is this error from" — a static string for a standalone app
    // (e.g. its own manifest/namespace id, known at construction time), or a
    // function for a shell hosting several embedded apps, where the answer
    // changes as the user navigates (called once per captured entry, not
    // cached) — e.g. `function () { return sessionStorage.getItem("my.app"); }`,
    // matching whatever fesr-enrichment.js's resolveActiveApp() reads for FESR
    // records, so errors and performance data correlate by the same appName.
    // Left unset, ui-error records simply won't carry an appName.
    appName: undefined,
    flushInterval: 10000,
    maxQueue: 50,
    maxPerMinute: 60,
    maxConsecutiveFailures: 3
  };

  /**
   * @param {object} [mOptions]
   * @param {string} [mOptions.endpoint="/service/telemetry/errors"]
   * @param {string} [mOptions.csrfEndpoint] defaults to the service root of `endpoint`
   * @param {string|function(): string} [mOptions.appName] see DEFAULTS.appName above
   * @param {int}    [mOptions.flushInterval=10000] ms between batch sends
   * @param {int}    [mOptions.maxQueue=50] drop-oldest cap on the pending queue
   * @param {int}    [mOptions.maxPerMinute=60] client-side rate limit (batches, not entries)
   * @param {int}    [mOptions.maxConsecutiveFailures=3] consecutive failed sends before pausing
   */
  function ErrorReporter(mOptions) {
    this._o = Object.assign({}, DEFAULTS, mOptions);
    if (!this._o.csrfEndpoint) {
      this._o.csrfEndpoint = this._o.endpoint.replace(/\/[^/]+$/, "") || "/";
    }
    this._queue = [];
    this._csrfToken = null;
    this._consecutiveFailures = 0;
    this._sentBatchTimestamps = [];
    this._flushTimer = null;
    this._logListener = null;

    this._onWindowError = this._onWindowError.bind(this);
    this._onUnhandledRejection = this._onUnhandledRejection.bind(this);
    this._onPageHide = this._onPageHide.bind(this);
  }

  ErrorReporter.prototype.start = function () {
    var that = this;

    this._logListener = {
      onLogEntry: function (oLogEntry) {
        if (oLogEntry.component === OWN_COMPONENT) {
          return; // never report our own diagnostics — avoids a feedback loop
        }
        if (oLogEntry.level > Log.Level.WARNING) {
          return; // only FATAL/ERROR/WARNING (lower number = more severe)
        }
        that._enqueue({
          level: oLogEntry.level <= Log.Level.ERROR ? "error" : "warning",
          message: oLogEntry.message,
          stackTrace: oLogEntry.details,
          errorSource: "ui5-log",
          componentName: oLogEntry.component
        });
      }
    };
    Log.addLogListener(this._logListener);

    window.addEventListener("error", this._onWindowError);
    window.addEventListener("unhandledrejection", this._onUnhandledRejection);
    window.addEventListener("pagehide", this._onPageHide);
    document.addEventListener("visibilitychange", this._onPageHide);

    this._flushTimer = setInterval(function () {
      that._flush();
    }, this._o.flushInterval);

    return this;
  };

  ErrorReporter.prototype.stop = function () {
    Log.removeLogListener(this._logListener);
    window.removeEventListener("error", this._onWindowError);
    window.removeEventListener("unhandledrejection", this._onUnhandledRejection);
    window.removeEventListener("pagehide", this._onPageHide);
    document.removeEventListener("visibilitychange", this._onPageHide);
    clearInterval(this._flushTimer);
  };

  ErrorReporter.prototype._onWindowError = function (oEvent) {
    this._enqueue({
      level: "error",
      message: oEvent.message,
      stackTrace: oEvent.error && oEvent.error.stack,
      errorSource: "window-error",
      url: oEvent.filename
    });
  };

  ErrorReporter.prototype._onUnhandledRejection = function (oEvent) {
    var vReason = oEvent.reason;
    this._enqueue({
      level: "error",
      message: vReason && vReason.message ? vReason.message : String(vReason),
      stackTrace: vReason && vReason.stack,
      errorSource: "unhandledrejection"
    });
  };

  ErrorReporter.prototype._onPageHide = function () {
    if (document.visibilityState === "hidden" || document.visibilityState === undefined) {
      this._flush({ keepalive: true });
    }
  };

  ErrorReporter.prototype._enqueue = function (oEntry) {
    if (this._consecutiveFailures >= this._o.maxConsecutiveFailures) {
      return; // circuit breaker open — backend is clearly unreachable, stop piling up
    }

    oEntry.url = oEntry.url || window.location.href;
    oEntry.userAgent = navigator.userAgent;
    oEntry.timestamp = new Date().toISOString();
    oEntry.appName = oEntry.appName || this._resolveAppName();

    this._queue.push(oEntry);
    if (this._queue.length > this._o.maxQueue) {
      this._queue.shift(); // drop oldest — keep the most recent signal
    }
  };

  ErrorReporter.prototype._resolveAppName = function () {
    try {
      return typeof this._o.appName === "function" ? this._o.appName() : this._o.appName;
    } catch (e) {
      return undefined; // a broken resolver must never break error capture itself
    }
  };

  ErrorReporter.prototype._withinRateLimit = function () {
    var iNow = Date.now();
    this._sentBatchTimestamps = this._sentBatchTimestamps.filter(function (iSentAt) {
      return iNow - iSentAt < 60000;
    });
    if (this._sentBatchTimestamps.length >= this._o.maxPerMinute) {
      return false;
    }
    this._sentBatchTimestamps.push(iNow);
    return true;
  };

  ErrorReporter.prototype._flush = function (mFetchOptions) {
    if (!this._queue.length || !this._withinRateLimit()) {
      return;
    }
    var aEntries = this._queue.splice(0, this._queue.length);
    this._send(aEntries, mFetchOptions);
  };

  ErrorReporter.prototype._send = function (aEntries, mFetchOptions) {
    var that = this;
    var oBody = JSON.stringify({ entries: aEntries });

    function post(sToken) {
      return fetch(that._o.endpoint, Object.assign({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": sToken || "Fetch",
          "X-Requested-With": "XMLHttpRequest"
        },
        credentials: "same-origin",
        body: oBody
      }, mFetchOptions || {}));
    }

    this._getCsrfToken()
      .then(post)
      .then(function (oResponse) {
        if (oResponse.status === 403) {
          // Token expired/invalid — refetch once and retry this same batch.
          that._csrfToken = null;
          return that._getCsrfToken().then(post);
        }
        return oResponse;
      })
      .then(function (oResponse) {
        if (oResponse.ok) {
          that._consecutiveFailures = 0;
        } else {
          that._onSendFailed();
        }
      })
      .catch(function () {
        that._onSendFailed();
      });
  };

  ErrorReporter.prototype._onSendFailed = function () {
    this._consecutiveFailures++;
    // Never Log.error()/warn() a send failure — that would re-enter the log
    // listener above and loop. console.debug only, and only that.
    if (window.console && window.console.debug) {
      window.console.debug(
        "[cap-ui-telemetry] ErrorReporter: send failed (" + this._consecutiveFailures + " consecutive)"
      );
    }
  };

  ErrorReporter.prototype._getCsrfToken = function () {
    var that = this;
    if (this._csrfToken) {
      return Promise.resolve(this._csrfToken);
    }
    return fetch(this._o.csrfEndpoint, {
      method: "HEAD",
      headers: { "X-CSRF-Token": "Fetch" },
      credentials: "same-origin"
    })
      .then(function (oResponse) {
        that._csrfToken = oResponse.headers.get("X-CSRF-Token");
        return that._csrfToken;
      })
      .catch(function () {
        return null;
      });
  };

  return ErrorReporter;
});
