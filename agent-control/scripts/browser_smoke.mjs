import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const [, , frontendUrl, expectedSha, username = "", password = "", timeoutArg = "120"] = process.argv;
const timeoutMs = Number(timeoutArg) * 1000;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const requireFromFrontend = createRequire(path.join(scriptDir, "..", "..", "FrontEnd", "package.json"));

function printAndExit(code, payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exit(code);
}

if (!frontendUrl || !expectedSha) {
  printAndExit(10, {
    status: "fail",
    notes: ["browser_smoke.mjs requires <frontendUrl> and <expectedSha> arguments."],
  });
}

let chromium;
try {
  ({ chromium } = requireFromFrontend("playwright"));
} catch (error) {
  printAndExit(40, {
    status: "skipped",
    notes: [`Playwright is not available from FrontEnd dependencies: ${error.message}`],
  });
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch (error) {
  printAndExit(40, {
    status: "skipped",
    notes: [`Chromium is not installed for Playwright: ${error.message}`],
  });
}

const page = await browser.newPage();
const notes = [];

try {
  await page.goto(frontendUrl, { waitUntil: "networkidle", timeout: timeoutMs });

  const versionPayload = await page.evaluate(async () => {
    const response = await fetch("/version.json", { cache: "no-store" });
    return await response.json();
  });

  if (versionPayload?.version !== expectedSha) {
    throw new Error(`Frontend version mismatch: expected ${expectedSha}, got ${versionPayload?.version ?? "unknown"}`);
  }
  notes.push("Frontend version.json matches the expected git SHA.");

  const appShell = page.locator("[data-account-mode]");
  if ((await appShell.count()) > 0) {
    await appShell.first().waitFor({ state: "visible", timeout: timeoutMs });
    notes.push("App shell was already visible.");
    await browser.close();
    printAndExit(0, { status: "pass", notes });
  }

  const usernameInput = page.locator('input[autocomplete="username"]').first();
  const passwordInput = page.locator('input[autocomplete="current-password"], input[autocomplete="new-password"]').first();

  await usernameInput.waitFor({ state: "visible", timeout: timeoutMs });
  notes.push("Login screen loaded.");

  if (username && password) {
    await usernameInput.fill(username);
    await passwordInput.fill(password);
    await page.locator('button[type="submit"]').first().click();
    await appShell.first().waitFor({ state: "visible", timeout: timeoutMs });
    notes.push("Logged into the UI and loaded the app shell.");
  } else {
    notes.push("UI login was not attempted because no verification credentials were supplied.");
  }

  await browser.close();
  printAndExit(0, { status: "pass", notes });
} catch (error) {
  if (browser) {
    await browser.close();
  }
  printAndExit(10, {
    status: "fail",
    notes: [error instanceof Error ? error.message : String(error)],
  });
}
