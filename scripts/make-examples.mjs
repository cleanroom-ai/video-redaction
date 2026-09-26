import { mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright-core";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(appDir, "examples");
mkdirSync(outDir, { recursive: true });
const scratch = join(outDir, "_recording");
rmSync(scratch, { recursive: true, force: true });
mkdirSync(scratch, { recursive: true });

let browser;
let context;
try {
  const channel = process.env.E2E_BROWSER || "msedge";
  const fakeOpenAiKey = ["sk", "proj"].join("-") + "-9fQ2xLr7TbWm4KpZ8vNs3HcYd1";
  const fakeAwsKey = "AK" + "IAIOSFODNN7EXAMPLE";
  browser = await chromium.launch(channel === "chromium" ? {} : { channel, headless: true });
  context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: scratch, size: { width: 1280, height: 720 } } });
  const page = await context.newPage();
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#0b1020;color:#e5e7eb;font:22px/1.45 Segoe UI,system-ui,sans-serif;overflow:hidden}.screen{width:1280px;height:720px;padding:42px;box-sizing:border-box;background:linear-gradient(135deg,#111827,#172554)}.top{height:42px;display:flex;gap:12px;align-items:center;color:#c7d2fe}.dot{width:12px;height:12px;border-radius:50%;background:#22d3ee}.panel{margin-top:24px;border:1px solid #334155;border-radius:18px;background:#020617cc;box-shadow:0 24px 80px #0008;overflow:hidden}.bar{padding:14px 18px;background:#111827;color:#94a3b8;font:16px ui-monospace,monospace}.terminal{height:450px;padding:24px 28px;font:30px/1.6 Consolas,ui-monospace,monospace;white-space:pre-wrap;color:#f8fafc}.chat{display:none;height:520px;padding:22px 28px;background:#f8fafc;color:#0f172a;overflow:hidden}.msg{margin:0 0 18px;padding:14px 18px;border-radius:16px;background:#e0e7ff;max-width:900px;font-size:30px}.sender{font-weight:800;color:#3730a3}.settings{display:none;height:520px;padding:34px;background:#fff;color:#111827}.row{display:flex;justify-content:space-between;border-bottom:1px solid #e5e7eb;padding:16px 0;font-size:30px}.red{color:#dc2626;font-weight:700}</style>
<div class="screen"><div class="top"><span class="dot"></span><strong>Video Redactor fake demo data</strong><span>Screen recording · no real secrets</span></div><section class="panel"><div class="bar" id="title">demo-terminal — .env</div><div class="terminal" id="term"></div><div class="chat" id="chat"><div id="chatInner"><div class="msg"><div class="sender">Nikhil Kulkarni 3:21 PM</div>Please repro with user nikhil.kulkarni@example.test or call +1 (415) 555-0198.</div><div class="msg"><div class="sender">Parag Sawant 3:22 PM</div>I see OPENAI_API_KEY in the terminal. Please redact before sharing.</div><div class="msg"><div class="sender">Nikhil Kulkarni 3:23 PM</div>Scrolling the fake chat so tracking follows text that moves.</div></div></div><div class="settings" id="settings"><h1>Project settings</h1><div class="row"><span>Owner</span><b>Nikhil Kulkarni</b></div><div class="row"><span>Webhook email</span><b>dev-team@example.test</b></div><div class="row"><span>API token</span><b class="red">${fakeOpenAiKey}</b></div><div class="row"><span>Status</span><b>Ready to export</b></div></div></section></div>`);
  const lines = ["$ cat .env", `OPENAI_API_KEY=${fakeOpenAiKey}`, `AWS_ACCESS_KEY_ID=${fakeAwsKey}`, "DATABASE_URL=******example.internal:5432/app", "CONTACT_EMAIL=nikhil.kulkarni@example.test", "SUPPORT_PHONE=+1 (415) 555-0198"];
  for (const line of lines) {
    await page.locator("#term").evaluate((el, text) => { el.textContent += text + "\n"; }, line);
    await page.waitForTimeout(420);
  }
  await page.waitForTimeout(900);
  await page.locator("#title").evaluate((el) => { el.textContent = "Teams chat — fake data"; });
  await page.locator("#term").evaluate((el) => { el.style.display = "none"; });
  await page.locator("#chat").evaluate((el) => { el.style.display = "block"; });
  await page.waitForTimeout(1600);
  await page.locator("#chat").evaluate((el) => { el.scrollTop = 120; });
  await page.waitForTimeout(1800);
  await page.locator("#title").evaluate((el) => { el.textContent = "Settings — fake data"; });
  await page.locator("#chat").evaluate((el) => { el.style.display = "none"; });
  await page.locator("#settings").evaluate((el) => { el.style.display = "block"; });
  await page.waitForTimeout(2400);
  await context.close();
  context = null;

  const list = spawnSync(process.platform === "win32" ? "powershell.exe" : "sh", process.platform === "win32" ? ["-NoProfile", "-Command", `Get-ChildItem '${scratch}' -Filter *.webm | Select-Object -First 1 -ExpandProperty FullName`] : ["-lc", `find '${scratch}' -name '*.webm' | head -n 1`], { encoding: "utf8" });
  const recorded = list.stdout.trim();
  if (!recorded) throw new Error("Playwright did not produce a WebM recording");
  const webm = join(outDir, "fake-screen.webm");
  renameSync(recorded, webm);
  console.log(`wrote ${webm}`);
  if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0) {
    const mp4 = join(outDir, "fake-screen.mp4");
    const enc = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", mp4], { stdio: "inherit" });
    if (enc.status === 0) console.log(`wrote ${mp4}`);
  }
  rmSync(scratch, { recursive: true, force: true });
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  if (context) await Promise.race([context.close(), new Promise((r) => setTimeout(r, 5000))]);
  if (browser) await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
  process.exit(process.exitCode || 0);
}
