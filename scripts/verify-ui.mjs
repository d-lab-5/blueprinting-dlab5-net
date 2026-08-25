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
  { width = 1400, height = 1000, before, act, awaitSelector, evaluate, shot }
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
      { expression: `!!document.querySelector(".bp-gate, .bp-shell")`, returnByValue: true },
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
    if (!appeared) throw new Error(`${awaitSelector} never appeared on ${path}`);
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
    hasGate: !!document.querySelector(".bp-gate"),
    hasShell: !!document.querySelector(".bp-shell"),
    railItems: document.querySelectorAll(".bp-rail__item").length,
    railPosition: style(rail, "position"),
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

const ROUTES = [
  { path: "/", name: "projects list" },
  { path: "/p/dlab5-blueprint/", name: "project · roadmap" },
  { path: "/p/dlab5-blueprint/views/", name: "project · views" },
  { path: "/p/dlab5-blueprint/radar/", name: "project · radar" },
  { path: "/p/dlab5-blueprint/model/", name: "project · model" },
  { path: "/p/dlab5-blueprint/blocks/", name: "project · blocks" },
];

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

  for (const route of ROUTES) {
    const shot = `in${route.path.replace(/[^a-z0-9]+/gi, "_") || "_root"}.png`;
    let result;
    try {
      result = await visit(cdp, route.path, {
        act: fill,
        awaitSelector: ".bp-shell",
        evaluate: PROBE,
        shot,
      });
    } catch (error) {
      check(false, `${route.name}: signs in and renders`, error.message);
      continue;
    }

    const { value, consoleErrors, failedRequests } = result;
    const isProject = route.path !== "/";

    check(value.h1s === 1, `${route.name}: exactly one <h1>`, `found ${value.h1s}`);
    check(!value.hasGate, `${route.name}: the gate is gone`);
    check(
      isProject ? value.railItems === 5 : value.railItems === 0,
      `${route.name}: ${isProject ? "five rail entries" : "no rail outside a project"}`,
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

  // The rail must fold away rather than eat a phone screen.
  try {
    const mobile = await visit(cdp, "/p/dlab5-blueprint/", {
      width: 390,
      height: 844,
      act: fill,
      awaitSelector: ".bp-shell",
      evaluate: PROBE,
      shot: "in_mobile.png",
    });
    check(
      mobile.value.railPosition === "static",
      "mobile: the rail stops being a side column",
      `position: ${mobile.value.railPosition}`
    );
  } catch (error) {
    check(false, "mobile: signs in and renders", error.message);
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
    check(value.hasGate, `${route.name}: renders the sign-in gate`);
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
  check(mobile.value.hasGate, "mobile: the gate renders at 390px");
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
  .finally(() => {
    chrome.kill();
    rmSync(profile, { recursive: true, force: true });
    process.exit(failures === 0 ? 0 : 1);
  });
