#!/usr/bin/env node
/**
 * Drives the built site with headless Chrome over the DevTools protocol.
 *
 * Every UI change before WP11 shipped with its rendering unverified, because
 * the browser extension cannot reach localhost. A green build says the bundle
 * compiled; it says nothing about whether a page renders, whether the console
 * is clean, or whether a heading exists. Both defects the design-implement
 * skill records from earlier runs — an image that did not fill its container,
 * a page with no h1 — passed the build.
 *
 * CDP rather than `--dump-dom`, because a DOM dump cannot see the console or a
 * failed request, and because Gatsby inlines critical CSS into the head: a
 * naive grep for a class name matches the stylesheet and reports markup that
 * is not there. Every assertion here runs inside the page, against the live
 * DOM, after hydration.
 *
 * No dependency: Node 22 ships a WebSocket client, which is all CDP needs.
 *
 *   npx gatsby serve -p 9000     # in packages/site, then:
 *   node scripts/verify-ui.mjs [--base http://localhost:9000] [--shots <dir>]
 *
 * Unauthenticated, every route must render the sign-in gate and nothing else.
 * That is not a limitation of the check — it is ADR-0002's invariant, and the
 * one a shell change is most likely to break.
 */
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const BASE = arg("--base", "http://localhost:9000");
const SHOTS = arg("--shots", "/tmp/bp-ui");
const PORT = Number(arg("--cdp-port", "9333"));

const CHROME = ["google-chrome-stable", "google-chrome", "chromium"].find((c) => {
  try {
    execFileSync("which", [c], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
});

if (!CHROME) {
  console.log("No Chrome on this machine — skipping. This check is advisory.");
  process.exit(0);
}

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ CDP -- */

class CDP {
  #ws;
  #next = 1;
  #pending = new Map();
  #listeners = [];

  static async attach(url) {
    const cdp = new CDP();
    cdp.#ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      cdp.#ws.addEventListener("open", resolve, { once: true });
      cdp.#ws.addEventListener("error", reject, { once: true });
    });
    cdp.#ws.addEventListener("message", (event) => cdp.#receive(event.data));
    return cdp;
  }

  #receive(raw) {
    const message = JSON.parse(raw);
    if (message.id !== undefined) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
      return;
    }
    for (const listener of this.#listeners) {
      listener(message.method, message.params ?? {}, message.sessionId);
    }
  }

  on(handler) {
    this.#listeners.push(handler);
  }

  /** Resolves once `method` arrives on `sessionId`, or rejects on timeout. */
  once(method, sessionId, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for ${method}`)),
        timeoutMs
      );
      const handler = (m, params, session) => {
        if (m !== method || session !== sessionId) return;
        clearTimeout(timer);
        this.#listeners.splice(this.#listeners.indexOf(handler), 1);
        resolve(params);
      };
      this.#listeners.push(handler);
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.#next++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    this.#ws.send(JSON.stringify(message));
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });
  }

  close() {
    this.#ws.close();
  }
}

/* --------------------------------------------------------------- launch -- */

const profile = mkdtempSync(join(tmpdir(), "bp-chrome-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    "--disable-extensions",
    "--hide-scrollbars",
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${PORT}`,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] }
);
// Chrome logs Mesa/Vulkan warnings on this workstation's Haswell graphics.
// They are noise, not a page problem, so the pipe is drained and dropped.
chrome.stderr.resume();

async function browserWebSocket() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const info = await response.json();
      if (info.webSocketDebuggerUrl) return info.webSocketDebuggerUrl;
    } catch {
      // Chrome has not opened the port yet.
    }
    await sleep(250);
  }
  throw new Error("Chrome never opened its debugging port");
}

/* ---------------------------------------------------------------- visit -- */

/**
 * Opens one route in its own tab and returns what the page did: the console,
 * the failed requests, and whatever `evaluate` returned from inside it.
 */
async function visit(
  cdp,
  path,
  { width = 1400, height = 1000, before, act, awaitSelector, awaitGone, then, evaluate, shot }
) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });

  const consoleErrors = [];
  const failedRequests = [];

  cdp.on((method, params, session) => {
    if (session !== sessionId) return;
    if (method === "Runtime.consoleAPICalled" && params.type === "error") {
      consoleErrors.push(
        (params.args ?? [])
          .map((a) => a.value ?? a.description ?? a.type)
          .join(" ")
      );
    }
    if (method === "Runtime.exceptionThrown") {
      const d = params.exceptionDetails ?? {};
      consoleErrors.push(d.exception?.description ?? d.text ?? "exception");
    }
    if (method === "Network.loadingFailed" && !params.canceled) {
      failedRequests.push(`${params.type} ${params.errorText}`);
    }
    if (method === "Network.responseReceived" && params.response.status >= 400) {
      failedRequests.push(`HTTP ${params.response.status} ${params.response.url}`);
    }
  });

  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Network.enable", {}, sessionId);
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width, height, deviceScaleFactor: 1, mobile: width < 600 },
    sessionId
  );

  // Anything that has to be true before the first paint — a theme in
  // localStorage, for instance — is set on the origin first, then the real
  // navigation happens. That is the only way to test the no-flash script,
  // which runs before the body exists and cannot be observed after the fact.
  if (before) {
    await cdp.send("Page.navigate", { url: `${BASE}/` }, sessionId);
    await cdp.once("Page.loadEventFired", sessionId);
    await cdp.send(
      "Runtime.evaluate",
      { expression: before, awaitPromise: true },
      sessionId
    );
  }

  await cdp.send("Page.navigate", { url: `${BASE}${path}` }, sessionId);
  await cdp.once("Page.loadEventFired", sessionId);

  // Hydration, not just load: assertions about rendered markup are meaningless
  // against the pre-React HTML.
  for (let attempt = 0; attempt < 40; attempt++) {
    const { result } = await cdp.send(
      "Runtime.evaluate",
      { expression: `!!document.querySelector(".bp-guest, .bp-shell, .bp-unconfigured")`,
          returnByValue: true,
        },
      sessionId
    );
    if (result.value) break;
    await sleep(150);
  }
  await sleep(400);

  // An action the page has to perform before it is worth measuring — signing
  // in, most of the time. Everything behind the gate is invisible otherwise.
  if (act) {
    const { exceptionDetails } = await cdp.send(
      "Runtime.evaluate",
      { expression: act, awaitPromise: true },
      sessionId
    );
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    }
  }

  if (awaitSelector) {
    let appeared = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      const { result } = await cdp.send(
        "Runtime.evaluate",
        {
          expression: `!!document.querySelector(${JSON.stringify(awaitSelector)})`,
          returnByValue: true,
        },
        sessionId
      );
      if (result.value) {
        appeared = true;
        break;
      }
      await sleep(250);
    }
    if (!appeared) {
      // A bare "never appeared" says nothing about why. The page is still
      // open, so ask it what it is showing before giving up — a wrong
      // password, a new-password challenge and a missed click all look
      // identical from the outside otherwise.
      const { result } = await cdp.send(
        "Runtime.evaluate",
        {
          expression: `JSON.stringify({
            error: document.querySelector(".bp-gate__error")?.textContent ?? null,
            heading: document.querySelector("h1, h2")?.textContent ?? null,
            subtitle: document.querySelector(".bp-gate__subtitle")?.textContent ?? null,
            button: document.querySelector(".bp-gate__card button[type=submit]")?.textContent ?? null,
            emailFilled: !!document.querySelector('input[type="email"]')?.value,
            passwordFilled: !!document.querySelector('input[type="password"]')?.value,
            stillOnForm: !!document.querySelector(".bp-gate__card"),
          })`,
          returnByValue: true,
        },
        sessionId
      );
      if (shot) {
        const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
        writeFileSync(join(SHOTS, `FAILED-${shot}`), Buffer.from(data, "base64"));
      }
      const state = JSON.parse(result.value ?? "{}");
      await cdp.send("Target.closeTarget", { targetId });
      throw new Error(
        `${awaitSelector} never appeared on ${path}\n` +
          `        page says: ${JSON.stringify(state)}\n` +
          `        console:   ${consoleErrors.slice(0, 3).join(" | ") || "(clean)"}\n` +
          `        failed:    ${failedRequests.slice(0, 3).join(" | ") || "(none)"}`
      );
    }
    await sleep(400);
  }

  // A selector appearing is not the page being ready. .bp-shell renders the
  // moment the session exists, while the model is still being fetched from
  // S3 — so every assertion after it was being made against "Loading model…".
  // Wait for that to clear, or the check measures the spinner.
  if (awaitGone) {
    let cleared = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      const { result } = await cdp.send(
        "Runtime.evaluate",
        {
          expression: `!document.body.textContent.includes(${JSON.stringify(awaitGone)})`,
          returnByValue: true,
        },
        sessionId
      );
      if (result.value) {
        cleared = true;
        break;
      }
      await sleep(250);
    }
    if (!cleared) {
      throw new Error(`"${awaitGone}" never cleared on ${path} — the model never arrived`);
    }
    await sleep(500);
  }

  // Runs after the page has settled, unlike `act` which runs the moment it
  // hydrates. Clicking something in a list needs the list to exist first.
  if (then) {
    const { exceptionDetails } = await cdp.send(
      "Runtime.evaluate",
      { expression: then, awaitPromise: true },
      sessionId
    );
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    }
    await sleep(400);
  }

  let value;
  if (evaluate) {
    const { result, exceptionDetails } = await cdp.send(
      "Runtime.evaluate",
      { expression: `JSON.stringify((() => { ${evaluate} })())`, returnByValue: true },
      sessionId
    );
    if (exceptionDetails) throw new Error(exceptionDetails.text);
    value = JSON.parse(result.value);
  }

  if (shot) {
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
    writeFileSync(join(SHOTS, shot), Buffer.from(data, "base64"));
  }

  await cdp.send("Target.closeTarget", { targetId });
  return { value, consoleErrors, failedRequests };
}

/* ----------------------------------------------------------------- main -- */

/** Runs inside the page. Everything asserted below comes from the live DOM. */
const PROBE = `
  const style = (el, prop) => el ? getComputedStyle(el).getPropertyValue(prop) : null;
  const rail = document.querySelector(".bp-rail");
  return {
    h1s: document.querySelectorAll("h1").length,
    h1: document.querySelector("h1")?.textContent ?? null,
    theme: document.documentElement.getAttribute("data-bp-theme"),
    bodyBackground: style(document.body, "background-color"),
    bodyColor: style(document.body, "color"),
    // The card, not the frame: the pre-hydration placeholder carries
    // .bp-gate too, so matching that would pass before React ran.
    hasSignIn: !!document.querySelector(".bp-gate__card"),
    hasGuestLanding: !!document.querySelector(".bp-guest"),
    constellationLayers: document.querySelectorAll(".bp-guest__legenditem").length,
    constellationNodes: document.querySelectorAll(
      ".bp-guest__constellation circle:not(.bp-guest__halo)"
    ).length,
    hasShell: !!document.querySelector(".bp-shell"),
    railItems: document.querySelectorAll(".bp-rail__item").length,
    railPosition: style(rail, "position"),
    // Proof the screen drew something from the model rather than an empty
    // frame: any of the real views, or a deliberate empty state.
    renderedContent: !!document.querySelector(
      ".bp-domains, .bp-canvas, .bp-orgs, .bp-radar, .bp-blockly, " +
        ".bp-gantt, .bp-views, .bp-empty, svg, table"
    ),
    // A clickable div is invisible to a keyboard. The design is full of them;
    // the port must not be.
    clickableNonControls: Array.from(
      document.querySelectorAll("[onclick]")
    ).filter((el) => !["A", "BUTTON", "INPUT", "SELECT"].includes(el.tagName)).length,
    // A control with neither text nor a label is unusable by a screen reader.
    unlabelledControls: Array.from(document.querySelectorAll("button, a")).filter(
      (el) =>
        !el.textContent.trim() &&
        !el.getAttribute("aria-label") &&
        !el.getAttribute("title")
    ).length,
  };
`;

/** Roadmap, Views, Radar, Domains, Blueprint, Teams, Blocks. */
const RAIL_ITEMS = 7;

const ROUTES = [
  { path: "/", name: "projects list" },
  { path: "/p/dlab5-blueprint/", name: "project · roadmap" },
  { path: "/p/dlab5-blueprint/views/", name: "project · views" },
  { path: "/p/dlab5-blueprint/radar/", name: "project · radar" },
  { path: "/p/dlab5-blueprint/domains/", name: "project · domains" },
  { path: "/p/dlab5-blueprint/blueprint/", name: "project · blueprint" },
  { path: "/p/dlab5-blueprint/orgs/", name: "project · teams" },
  // The old path for the same screen. It is an alias on purpose, so that a
  // link made before the rename still resolves.
  { path: "/p/dlab5-blueprint/model/", name: "project · model (alias)" },
  { path: "/p/dlab5-blueprint/blocks/", name: "project · blocks" },
];

/**
 * Importing a Mermaid Gantt.
 *
 * Driven rather than trusted: the parser has unit tests, but nothing else
 * proves the paste box reaches it, that the preview counts what was parsed, or
 * that applying actually grows the model. It adds to the in-memory model only,
 * so this never writes to the project.
 */
async function ganttImport(cdp) {
  console.log("\ngantt import");

  const CHART = [
    "gantt",
    "    section Verification",
    "    A checked task :done, vt1, 2026-01-01, 2026-01-10",
    "    A checked milestone :milestone, vm1, 2026-01-10, 0d",
    "    A following task :active, vt2, after vt1, 5d",
    "    this line is not a task",
  ].join("\n");

  const paste =
    "(async () => {" +
    "  document.querySelector('.bp-import')?.setAttribute('open','');" +
    "  await new Promise((r) => setTimeout(r, 150));" +
    "  const area = document.querySelector('.bp-import textarea');" +
    "  const setter = Object.getOwnPropertyDescriptor(" +
    "    window.HTMLTextAreaElement.prototype, 'value').set;" +
    "  setter.call(area, " + JSON.stringify(CHART) + ");" +
    "  area.dispatchEvent(new Event('input', { bubbles: true }));" +
    "  await new Promise((r) => setTimeout(r, 400));" +
    "  window.__before = document.querySelectorAll('.bp-editor__item').length;" +
    // Read the preview BEFORE applying: applying clears the textarea, which
    // correctly tears the preview down, so reading afterwards finds nothing.
    "  window.__preview = document.querySelector('.bp-import__summary')?.textContent.trim() ?? null;" +
    "  window.__skipped = document.querySelector('.bp-import__skipped summary')?.textContent.trim() ?? null;" +
    "  document.querySelector('.bp-import .bp-button')?.click();" +
    "  await new Promise((r) => setTimeout(r, 600));" +
    "})()";

  const READ = `
    return {
      before: window.__before ?? null,
      after: document.querySelectorAll(".bp-editor__item").length,
      summary: window.__preview ?? null,
      skipped: window.__skipped ?? null,
      // Applying should reset the panel, so the preview is gone now.
      previewCleared: !document.querySelector(".bp-import__summary"),
    };
  `;

  let result;
  try {
    result = await visit(cdp, "/p/dlab5-blueprint/", {
      awaitSelector: ".bp-shell",
      awaitGone: "Loading model",
      then: paste,
      evaluate: READ,
      shot: "gantt_import.png",
    });
  } catch (error) {
    check(false, "the import panel is usable", error.message);
    return;
  }

  const v = result.value;
  check(
    v.summary !== null,
    "pasting a chart previews what was parsed",
    v.summary ?? "no summary"
  );
  check(
    /1 plateau, 2 work packages, 1 milestone/.test(v.summary ?? ""),
    "the preview counts sections, tasks and milestones correctly",
    v.summary ?? ""
  );
  check(
    /1 line/.test(v.skipped ?? ""),
    "a line it cannot read is reported rather than swallowed",
    v.skipped ?? "nothing reported"
  );
  check(
    v.before !== null && v.after === v.before + 4,
    "applying adds exactly the parsed elements",
    `${v.before} -> ${v.after}, expected +4`
  );
  check(v.previewCleared, "applying clears the paste box, so it cannot be applied twice");
}

/**
 * Centring the structure view on one element.
 *
 * The control narrows the model before the diagram is generated, so the check
 * is that the count actually falls and that more hops reach more — a filter
 * that silently does nothing looks identical to one that works.
 */
async function focusView(cdp) {
  console.log("\nstructure focus");

  const READ = `
    const select = document.querySelector(".bp-focus select");
    // Scoped to the diagram container. A bare "svg" selector matches the
    // rail's icons, so it reported a rendered diagram on a page showing
    // "[object Object]" — the third false pass from a too-loose selector.
    const diagram = document.querySelector(".bp-diagram");
    return {
      options: select ? select.options.length : 0,
      count: document.querySelector(".bp-focus__count")?.textContent.trim() ?? null,
      rendered: !!diagram?.querySelector("svg"),
      isError: !!document.querySelector(".bp-diagram--error"),
      errorText: document.querySelector(".bp-diagram--error pre")?.textContent.trim() ?? null,
      stillRendering: document.body.textContent.includes("Rendering"),
      // The failure mode this whole exercise uncovered.
      objectObject: document.body.textContent.includes("[object Object]"),
    };
  `;

  /** Picks the nth element in the list and sets the hop count. */
  const centre = (index, hops) =>
    "(async () => {" +
    "  const setter = Object.getOwnPropertyDescriptor(" +
    "    window.HTMLSelectElement.prototype, 'value').set;" +
    "  const selects = [...document.querySelectorAll('.bp-focus select')];" +
    "  const s = selects[0];" +
    "  setter.call(s, s.options[" + index + "].value);" +
    "  s.dispatchEvent(new Event('change', { bubbles: true }));" +
    "  await new Promise((r) => setTimeout(r, 400));" +
    "  const hopSel = [...document.querySelectorAll('.bp-focus select')][1];" +
    "  if (hopSel) {" +
    "    setter.call(hopSel, '" + hops + "');" +
    "    hopSel.dispatchEvent(new Event('change', { bubbles: true }));" +
    "    await new Promise((r) => setTimeout(r, 400));" +
    "  }" +
    // D2 compiles through WASM, which takes noticeably longer than a React
    // render. Without this the shot catches "Rendering…" and the assertion
    // below measures a placeholder.
    "  for (let i = 0; i < 60; i++) {" +
    "    if (!document.body.textContent.includes('Rendering')) break;" +
    "    await new Promise((r) => setTimeout(r, 250));" +
    "  }" +
    "  await new Promise((r) => setTimeout(r, 300));" +
    "})()";

  const parse = (text) => {
    const m = /(\d+) of (\d+) elements/.exec(text ?? "");
    return m ? { shown: Number(m[1]), total: Number(m[2]) } : null;
  };

  let base;
  try {
    base = await visit(cdp, "/p/dlab5-blueprint/views/", {
      awaitSelector: ".bp-shell",
      awaitGone: "Loading model",
      // D2 compiles through WASM in a worker; it is far slower than a React
      // render and the page says "Rendering…" until it lands.
      then:
        "(async () => { for (let i = 0; i < 80; i++) {" +
        "  if (!document.body.textContent.includes('Rendering')) break;" +
        "  await new Promise((r) => setTimeout(r, 250));" +
        "} await new Promise((r) => setTimeout(r, 400)); })()",
      evaluate: READ,
      shot: "focus_none.png",
    });
  } catch (error) {
    check(false, "structure view loads", error.message);
    return;
  }

  check(
    base.value.options > 1,
    "every element is offered as a focus",
    `${base.value.options} options`
  );
  check(base.value.count === null, "no count until something is centred on");
  check(
    base.value.rendered && !base.value.objectObject && !base.value.isError,
    "the whole-model structure diagram draws",
    base.value.objectObject
      ? "rendered [object Object]"
      : base.value.isError
        ? `error: ${base.value.errorText?.slice(0, 90)}`
        : base.value.stillRendering
          ? "stuck on Rendering…"
          : ""
  );

  const readings = {};
  for (const hops of [1, 3]) {
    let result;
    try {
      result = await visit(cdp, "/p/dlab5-blueprint/views/", {
        awaitSelector: ".bp-shell",
        awaitGone: "Loading model",
        then: centre(1, hops),
        evaluate: READ,
        shot: `focus_depth${hops}.png`,
      });
    } catch (error) {
      check(false, `centring at ${hops} hop(s)`, error.message);
      continue;
    }
    readings[hops] = parse(result.value.count);
    check(
      readings[hops] !== null,
      `centring at ${hops} hop(s) reports a count`,
      (result.value.count ?? "no count shown").slice(0, 40)
    );
    // The point of narrowing is a diagram you can read. One that never
    // finishes compiling is worse than the full model.
    const v = result.value;
    const drew = v.rendered && !v.stillRendering && !v.isError && !v.objectObject;
    check(
      drew,
      `centring at ${hops} hop(s) still draws a diagram`,
      // Only describe the failure. A detail string built unconditionally
      // prints "no svg" beside a PASS, which reads as a contradiction.
      drew
        ? ""
        : v.objectObject
          ? "rendered [object Object]"
          : v.isError
            ? `error: ${v.errorText?.slice(0, 90)}`
            : v.stillRendering
              ? "stuck on Rendering…"
              : "no svg inside .bp-diagram"
    );
  }

  if (readings[1] && readings[3]) {
    check(
      readings[1].shown < readings[1].total,
      "centring actually narrows the model",
      `${readings[1].shown} of ${readings[1].total}`
    );
    check(
      readings[3].shown >= readings[1].shown,
      "more hops reach at least as much",
      `1 hop: ${readings[1].shown}, 3 hops: ${readings[3].shown}`
    );
  }
}

/**
 * The roadmap editor, driven by clicking.
 *
 * Which fields an element type carries is declared in the overlay ontology, so
 * a wrong answer here means the ontology and the form have drifted apart —
 * exactly the drift bp:appliesTo exists to prevent. Loading the page proves
 * none of it; the fields only appear once something is selected.
 */
async function editor(cdp) {
  console.log("\nroadmap editor");

  /** Selects the first element of `type` in the list. */
  const select = (type) =>
    "(async () => {" +
    "  const items = [...document.querySelectorAll('.bp-editor__item')];" +
    "  const item = items.find((b) =>" +
    "    b.querySelector('.bp-editor__item-type')?.textContent.trim() === " +
    JSON.stringify(type) +
    "  );" +
    "  if (item) item.click();" +
    "  await new Promise((r) => setTimeout(r, 250));" +
    // Bring the form into shot: the editor sits below the Gantt, so a
    // screenshot of the viewport top shows the chart and not the thing under
    // test.
    "  document.querySelector('.bp-editor__detail')?.scrollIntoView({block:'center'});" +
    "  await new Promise((r) => setTimeout(r, 150));" +
    "})()";

  const PROBE_FORM = `
    const detail = document.querySelector(".bp-editor__detail");
    return {
      fields: [...detail.querySelectorAll(".bp-field > span")].map((s) => s.textContent.trim()),
      headings: [...detail.querySelectorAll(".bp-rels h3")].map((h) => h.textContent.trim()),
      derived: detail.querySelector(".bp-derived")?.textContent.trim() ?? null,
      anySelected: !!document.querySelector(".bp-editor__item--selected"),
    };
  `;

  const CASES = [
    ["Work Package", ["Start date", "End date", "Cost", "Status"], []],
    ["Implementation Event", ["Start date", "Status"], ["End date", "Cost"]],
    ["Plateau", ["Status"], ["Start date", "End date", "Cost"]],
    ["Deliverable", ["Status"], ["Start date", "End date", "Cost"]],
    ["Gap", ["Status"], ["Start date", "End date", "Cost"]],
  ];

  for (const [type, expect, forbid] of CASES) {
    let result;
    try {
      result = await visit(cdp, "/p/dlab5-blueprint/", {
        awaitSelector: ".bp-shell",
        awaitGone: "Loading model",
        then: select(type),
        evaluate: PROBE_FORM,
        shot: `editor_${type.replace(/\W+/g, "_")}.png`,
      });
    } catch (error) {
      check(false, `${type}: selectable in the editor`, error.message);
      continue;
    }

    const form = result.value;
    if (!form.anySelected) {
      check(false, `${type}: present in the model and selectable`);
      continue;
    }

    const missing = expect.filter((f) => !form.fields.includes(f));
    const present = forbid.filter((f) => form.fields.includes(f));

    check(
      missing.length === 0,
      `${type}: offers ${expect.join(", ")}`,
      missing.length ? `missing ${missing.join(", ")}` : ""
    );
    if (forbid.length) {
      check(
        present.length === 0,
        `${type}: no ${forbid.join("/")}`,
        present.length ? `wrongly offers ${present.join(", ")}` : ""
      );
    }

    if (type === "Plateau") {
      check(
        form.derived !== null,
        "Plateau: shows a derived date instead of an editable one",
        form.derived ? form.derived.slice(0, 60) : "no derived block"
      );
    }
    if (type === "Work Package") {
      check(
        form.headings.includes("Incoming relationships"),
        "the editor shows incoming relationships, not only outgoing",
        form.headings.join(" | ")
      );
    }
  }

  // The first plateau in the list may be one nothing realises, which shows
  // "not yet scheduled" — correct, and proof of the empty path only. Walk all
  // of them and require at least one real derived date, or the derivation
  // could be returning nothing and every assertion above would still pass.
  const walk = await visit(cdp, "/p/dlab5-blueprint/", {
    awaitSelector: ".bp-shell",
    awaitGone: "Loading model",
    then:
      "(async () => { window.__derived = [];" +
      "  const items = [...document.querySelectorAll('.bp-editor__item')]" +
      "    .filter((b) => b.querySelector('.bp-editor__item-type')?.textContent.trim() === 'Plateau');" +
      "  for (const item of items) {" +
      "    item.click();" +
      "    await new Promise((r) => setTimeout(r, 200));" +
      "    const t = document.querySelector('.bp-derived')?.textContent.trim();" +
      "    if (t) window.__derived.push(t);" +
      "  } })()",
    evaluate: "return { texts: window.__derived ?? [] };",
  }).catch((error) => {
    check(false, "plateaus: walkable", error.message);
    return null;
  });

  if (walk?.value) {
    const dated = walk.value.texts.filter((t) => /\d{4}-\d{2}-\d{2}/.test(t));
    check(
      walk.value.texts.length > 0,
      "every plateau shows a derived-date block",
      `${walk.value.texts.length} plateaus`
    );
    check(
      dated.length > 0,
      "at least one plateau shows a real derived date",
      dated[0]?.slice(0, 70) ?? "none carried a date"
    );
  }
}

/**
 * The signed-in pass, which is the only way to see the rail at all.
 *
 * It drives the real sign-in form against the real Cognito pool rather than
 * faking a session, for the same reason the rest of this repo verifies against
 * foreign tools: a stubbed session would prove the stub works. Skipped without
 * credentials, and it says so — an unverified rail must not read as a verified
 * one.
 */
async function signedIn(cdp) {
  const user = process.env.BP_USER;
  const password = process.env.BP_PASSWORD;

  console.log("\nsigned in");
  if (!user || !password) {
    console.log(
      "  SKIP  the rail, the switcher and the theme toggle are NOT verified\n" +
        "        set BP_USER and BP_PASSWORD to drive them"
    );
    return;
  }

  // React tracks input values on the DOM node, so assigning `.value` directly
  // is silently reverted on the next render. Going through the prototype
  // setter and dispatching an input event is what makes the change real.
  const fill = `
    const set = (el, value) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, "value"
      ).set;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set(document.querySelector('input[type="email"]'), ${JSON.stringify(user)});
    set(document.querySelector('input[type="password"]'), ${JSON.stringify(password)});
    document.querySelector(".bp-gate__card button[type=submit]").click();
  `;

  // Sign in ONCE, then reuse the session.
  //
  // This used to sign in on every route, which meant a wrong password was
  // retried ten times a run — enough to trip Cognito's "Password attempts
  // exceeded" lockout on the account being tested. Signing in per route was
  // never necessary anyway: the tabs share an origin, and Amplify keeps its
  // tokens in localStorage, so one sign-in carries the whole pass.
  let established;
  try {
    established = await visit(cdp, "/", {
      act: fill,
      awaitSelector: ".bp-shell",
      evaluate: PROBE,
      shot: "in_root.png",
    });
  } catch (error) {
    check(false, "signs in", error.message);
    console.log(
      "\n  Stopping the signed-in pass after ONE failed attempt, deliberately.\n" +
        "  Retrying a rejected password is what locks the account out."
    );
    return;
  }

  check(established.value.h1s === 1, "projects list: exactly one <h1>");
  check(!established.value.hasSignIn, "projects list: the sign-in form is gone");
  check(established.value.railItems === 0, "projects list: no rail outside a project");

  for (const route of ROUTES.slice(1)) {
    const shot = `in${route.path.replace(/[^a-z0-9]+/gi, "_") || "_root"}.png`;
    let result;
    try {
      // No `act`: the session is already in localStorage for this origin.
      result = await visit(cdp, route.path, {
        awaitSelector: ".bp-shell",
        awaitGone: "Loading model",
        evaluate: PROBE,
        shot,
      });
    } catch (error) {
      check(false, `${route.name}: renders signed in`, error.message);
      continue;
    }

    const { value, consoleErrors, failedRequests } = result;

    check(value.h1s === 1, `${route.name}: exactly one <h1>`, `found ${value.h1s}`);
    check(!value.hasSignIn, `${route.name}: the gate is gone`);
    check(
      value.renderedContent,
      `${route.name}: the model rendered, not an empty frame`
    );
    check(
      value.railItems === RAIL_ITEMS,
      `${route.name}: ${RAIL_ITEMS} rail entries`,
      `${value.railItems} items`
    );
    check(
      value.clickableNonControls === 0,
      `${route.name}: every clickable is a real control`,
      `${value.clickableNonControls} non-controls`
    );
    check(
      value.unlabelledControls === 0,
      `${route.name}: every control has an accessible name`,
      `${value.unlabelledControls} unlabelled`
    );
    check(
      consoleErrors.length === 0,
      `${route.name}: console clean`,
      consoleErrors.slice(0, 2).join(" | ")
    );
    check(
      failedRequests.length === 0,
      `${route.name}: no failed requests`,
      failedRequests.slice(0, 2).join(" | ")
    );
  }

  await editor(cdp);
  await focusView(cdp);
  await ganttImport(cdp);

  // The rail must fold away rather than eat a phone screen.
  try {
    const mobile = await visit(cdp, "/p/dlab5-blueprint/", {
      width: 390,
      height: 844,
      awaitSelector: ".bp-shell",
      awaitGone: "Loading model",
      evaluate: PROBE,
      shot: "in_mobile.png",
    });
    check(
      mobile.value.railPosition === "static",
      "mobile: the rail stops being a side column",
      `position: ${mobile.value.railPosition}`
    );
  } catch (error) {
    check(false, "mobile: renders signed in", error.message);
  }
}

const main = async () => {
  rmSync(SHOTS, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });

  const cdp = await CDP.attach(await browserWebSocket());
  console.log(`UI, driven over CDP with ${CHROME}\n  base ${BASE}\n`);

  console.log("routes");
  for (const route of ROUTES) {
    const code = execFileSync(
      "curl",
      ["-s", "-o", "/dev/null", "-w", "%{http_code}", `${BASE}${route.path}`],
      { encoding: "utf8" }
    ).trim();
    check(code === "200", `${route.name} — HTTP ${code}`);
  }

  console.log("\nrendering, signed out");
  for (const route of ROUTES) {
    const shot = `${route.path.replace(/[^a-z0-9]+/gi, "_") || "root"}.png`;
    const { value, consoleErrors, failedRequests } = await visit(cdp, route.path, {
      evaluate: PROBE,
      shot,
    });

    check(value.h1s === 1, `${route.name}: exactly one <h1>`, `found ${value.h1s}`);
    check(value.hasSignIn, `${route.name}: renders the sign-in form`);
    check(value.hasGuestLanding, `${route.name}: renders the guest landing`);
    check(
      value.railItems === 0 && !value.hasShell,
      `${route.name}: no shell or rail before sign-in`,
      `${value.railItems} rail items`
    );
    check(
      value.clickableNonControls === 0,
      `${route.name}: every clickable is a real control`,
      `${value.clickableNonControls} non-controls`
    );
    check(
      value.unlabelledControls === 0,
      `${route.name}: every control has an accessible name`,
      `${value.unlabelledControls} unlabelled`
    );
    check(
      consoleErrors.length === 0,
      `${route.name}: console clean`,
      consoleErrors.slice(0, 2).join(" | ")
    );
    check(
      failedRequests.length === 0,
      `${route.name}: no failed requests`,
      failedRequests.slice(0, 2).join(" | ")
    );
  }

  const landing = await visit(cdp, "/", { evaluate: PROBE, shot: "guest-landing.png" });
  check(
    landing.value.constellationLayers >= 4,
    "the guest landing legends every populated ArchiMate layer",
    `${landing.value.constellationLayers} layers`
  );
  check(
    landing.value.constellationNodes === 60,
    "the constellation draws all 60 element types",
    `${landing.value.constellationNodes} nodes`
  );

  console.log("\nthemes");
  const dark = await visit(cdp, "/", {
    before: `localStorage.setItem("bp-theme", "dark")`,
    evaluate: PROBE,
    shot: "theme-dark.png",
  });
  const light = await visit(cdp, "/", {
    before: `localStorage.setItem("bp-theme", "light")`,
    evaluate: PROBE,
    shot: "theme-light.png",
  });

  check(dark.value.theme === "dark", "a stored dark theme is applied before paint");
  check(
    light.value.theme === "light",
    "a stored light theme is applied before paint",
    `got ${light.value.theme}`
  );
  // The attribute alone proves nothing — it has to actually repaint. If the
  // light tokens were missing, both themes would compute the same background.
  check(
    dark.value.bodyBackground !== light.value.bodyBackground,
    "the two themes paint different backgrounds",
    `${dark.value.bodyBackground} vs ${light.value.bodyBackground}`
  );
  check(
    dark.value.bodyColor !== light.value.bodyColor,
    "the two themes use different text colours",
    `${dark.value.bodyColor} vs ${light.value.bodyColor}`
  );

  console.log("\nnarrow viewport");
  const mobile = await visit(cdp, "/p/dlab5-blueprint/", {
    width: 390,
    height: 844,
    evaluate: PROBE,
    shot: "mobile-roadmap.png",
  });
  check(mobile.value.h1s === 1, "mobile: exactly one <h1>", `found ${mobile.value.h1s}`);
  check(mobile.value.hasSignIn, "mobile: the sign-in form renders at 390px");
  check(
    mobile.consoleErrors.length === 0,
    "mobile: console clean",
    mobile.consoleErrors.slice(0, 2).join(" | ")
  );

  await signedIn(cdp);

  cdp.close();
  console.log(`\nscreenshots in ${SHOTS}`);
  console.log(`\n${failures === 0 ? "all checks passed" : `${failures} FAILED`}`);
};

main()
  .catch((error) => {
    console.error(`\nverify:ui could not run — ${error.message}`);
    failures++;
  })
  .finally(async () => {
    chrome.kill();
    // Wait for it to actually go, then delete with retries: Chrome writes its
    // profile out as it shuts down, and a plain rmSync loses the race and
    // throws ENOTEMPTY over the top of the real result.
    await new Promise((resolve) => {
      if (chrome.exitCode !== null) return resolve();
      chrome.once("exit", resolve);
      setTimeout(resolve, 3000);
    });
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      // A leftover temp profile is not worth failing a verification run over.
    }
    process.exit(failures === 0 ? 0 : 1);
  });
