/*
 * cap-ui-telemetry — Step 2 (optional but recommended): enrich FESR records
 * with "which app is open right now".
 *
 * Without this, every FESR record's appNameShort/appNameLong is whatever UI5
 * derives from the component that triggered the interaction. That's fine for
 * a single standalone app, but in a shell hosting several embedded Fiori
 * Elements apps (in-place Component.create, not iframes) you usually want the
 * SHELL's own notion of "which app is open", not just the triggering
 * component's technical name — so p95-duration-by-app dashboards line up with
 * how users actually think about your apps.
 *
 * Call registerFesrEnrichment() ONCE, early — in the shell's Component.init(),
 * before the first user interaction completes (FESR builds its record when an
 * interaction ends, reading whatever onBeforeCreated returns at that moment).
 */
sap.ui.define(["sap/ui/performance/trace/FESR"], function (FESR) {
  "use strict";

  function registerFesrEnrichment() {
    var fnOriginalOnBeforeCreated = FESR.onBeforeCreated;

    FESR.onBeforeCreated = function (oFESRHandle, oInteraction) {
      var oHandle = fnOriginalOnBeforeCreated(oFESRHandle, oInteraction);
      var oActiveApp = resolveActiveApp(oInteraction);

      return Object.assign({}, oHandle, {
        appNameShort: oActiveApp.appNameShort || oHandle.appNameShort,
        appNameLong: oActiveApp.appNameLong || oHandle.appNameLong
      });
    };
  }

  /**
   * Resolves "which app is open" — adapt the first branch (or add your own)
   * to match your shell. Falls through to UI5's own component-derived name
   * if nothing matches, so this never produces an empty appName.
   */
  function resolveActiveApp() {
    // --- Variant 1: custom UI5 launchpad shell (no sap.ushell) -------------
    // Matches a shell that tracks the currently open app's id in
    // sessionStorage and/or a JSON model (e.g. cs-portal's csportalshell:
    // sessionStorage["csportal.app"], model "appState" with a "currentTitle"
    // property — see App.controller.js). Adjust the key to your own shell.
    try {
      var sAppId = window.sessionStorage.getItem("csportal.app");
      if (sAppId) {
        return { appNameShort: sAppId, appNameLong: sAppId };
      }
    } catch (e) {
      // sessionStorage unavailable (e.g. private browsing) — fall through
    }

    // --- Variant 2: sap.ushell (Fiori Launchpad / cFLP) ---------------------
    // Uncomment if your shell IS ushell-based. AppLifeCycle is async, so it
    // can't be queried synchronously from inside onBeforeCreated — instead,
    // subscribe once at shell startup and cache the last-known app id:
    //
    // sap.ushell.Container.getServiceAsync("AppLifeCycle").then(function (oService) {
    //   oService.attachAppLoaded(function (oEvent) {
    //     window.__capUiTelemetryActiveApp = oEvent.getParameter("componentInstance").getId();
    //   });
    // });
    // if (window.__capUiTelemetryActiveApp) {
    //   return {
    //     appNameShort: window.__capUiTelemetryActiveApp,
    //     appNameLong: window.__capUiTelemetryActiveApp
    //   };
    // }

    // --- Variant 3: single standalone app (no shell at all) -----------------
    // Nothing to resolve — just fall through to UI5's own default below.
    return {};
  }

  return { register: registerFesrEnrichment };
});
