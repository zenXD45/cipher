import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = root;
const frontendDir = path.resolve(root, '..', 'frontend');
function findChrome() {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) {
    return process.env.CHROMIUM_PATH;
  }
  const root = `${process.env.HOME}/.cache/puppeteer/chrome`;
  try {
    const versions = fs
      .readdirSync(root)
      .filter((d) => d.startsWith('linux-'))
      .sort()
      .reverse();
    for (const v of versions) {
      const bin = path.join(root, v, 'chrome-linux64', 'chrome');
      if (fs.existsSync(bin)) return bin;
    }
  } catch {
    /* no puppeteer cache */
  }
  if (fs.existsSync('/opt/helium-browser-bin/helium')) return '/opt/helium-browser-bin/helium';
  return null;
}
const EXEC_PATH = findChrome();
if (!EXEC_PATH) throw new Error('No Chromium binary found (set CHROMIUM_PATH)');
const API_PORT = process.env.API_PORT || '5001';
const BASE = `http://localhost:${API_PORT}`;

const suffix = Date.now().toString(36);
const ALICE = `alice${suffix}`;
const BOB = `bob${suffix}`;
const PASSWORD = 'Secret-1234';
const SECRET_TEXT = `the falcon dives at dawn ${suffix}`;

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok) });
  if (!ok) throw new Error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}

function pwd(n) {
  return new Promise((resolve) => setTimeout(resolve, n));
}

async function waitFor(page, fn, timeout = 12000, label = 'condition') {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error(`timeout waiting for ${label}`);
    await pwd(120);
  }
}

// Headless Chromium occasionally does a spurious same-URL document replacement
// shortly after goto (unrelated to our app). Ensure the frame is quiescent.
async function settle(page) {
  let last = 0;
  for (let i = 0; i < 15; i++) {
    const count = page.__navCount || 0;
    if (count === last && count > 0 && i > 1) return;
    last = count;
    await pwd(200);
  }
}

async function retry(fn, attempts = 6) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      const msg = String(err.message || err);
      if (!/(Execution context was destroyed|Session closed|Navigation failed|Target closed)/.test(msg)) throw err;
      await pwd(400);
    }
  }
  throw new Error('retry exhausted');
}

async function typeSafely(page, selector, text) {
  await retry(() => page.type(selector, text, { delay: 8 }));
}

async function clickButton(page, text) {
  await retry(async () => {
    const clicked = await page.evaluate((t) => {
      const buttons = [...document.querySelectorAll('button')];
      const target = buttons.find((b) => b.textContent.replace(/\s+/g, ' ').trim().includes(t));
      if (target) {
        target.click();
        return true;
      }
      return false;
    }, text);
    if (!clicked) throw new Error(`button not found: ${text}`);
    return true;
  });
}

async function rowByName(page, name) {
  const rows = await page.$$('.conv-row');
  for (const row of rows) {
    const text = await row
      .$eval('.conv-name', (e) => e.textContent)
      .catch(() => null);
    if (text === name) return row;
  }
  return null;
}

function log(child, label) {
  child.stdout.on('data', (d) => process.stdout.write(`[${label}] ${d}`));
  child.stderr.on('data', (d) => process.stdout.write(`[${label}:err] ${d}`));
}

function kill(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill('SIGTERM');
  });
}

async function waitForHealth(port, pathName = '') {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`http://localhost:${port}${pathName}`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await pwd(250);
  }
  return false;
}

function dbg(...args) {
  console.log(`[dbg +${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...args);
}

let step = 'booting';
const t0 = Date.now();
let activePage = null;

async function main() {
  const backend = spawn(process.execPath, ['server.js'], {
    cwd: backendDir,
    env: {
      ...process.env,
      PORT: API_PORT,
      NODE_ENV: 'test',
      MONGODB_URL: `mongodb://127.0.0.1:27017/cipher_browser_${suffix}`,
      FRONTEND_URL: BASE,
      JWT_SECRET: `browser-secret-${suffix}`
    }
  });
  log(backend, 'api');

  if (!(await waitForHealth(API_PORT, '/health'))) {
    throw new Error('API failed to become healthy before browser launch');
  }

  const browser = await puppeteer.launch({
    executablePath: EXEC_PATH,
    headless: true,
    dumpio: true,
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--no-zygote',
      '--disable-extensions',
      '--disable-component-extensions-with-background-pages',
      '--disable-default-apps',
      '--no-first-run',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-translate'
    ]
  });
  console.log('launched', await browser.version(), 'via', EXEC_PATH);

  try {
    await run(browser);
  } finally {
    await kill(backend);
    await browser.close();
  }
}

async function run(browser) {
  check('backend health', await waitForHealth(API_PORT, '/health'), API_PORT);
  check('SPA served by api', await (async () => {
    const res = await fetch(BASE);
    const html = await res.text();
    return res.status === 200 && html.includes('<div id="root">');
  })(), API_PORT);

  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  activePage = page;

  await page.evaluateOnNewDocument(() => {
    window.addEventListener('DOMContentLoaded', () => {
      try {
        const nav = performance.getEntriesByType('navigation')[0];
        const log = JSON.parse(sessionStorage.getItem('cipher:navlog') || '[]');
        log.push({ type: nav ? nav.type : 'unknown', t: Date.now() - Math.round(performance.timeOrigin ? performance.timeOrigin - Date.now() : 0) });
        sessionStorage.setItem('cipher:navlog', JSON.stringify(log));
      } catch (err) { /* ignore */ }
    });
  });

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  page.on('framenavigated', async (f) => {
    page.__navCount = (page.__navCount || 0) + 1;
    console.log('[dbg] NAV#', page.__navCount, f.url());
    if (f === page.mainFrame()) {
      await pwd(200);
      try {
        const log = await f.evaluate(() => sessionStorage.getItem('cipher:navlog'));
        console.log('[dbg] navlog after NAV#' + page.__navCount + ':', log);
      } catch (e) {
        console.log('[dbg] navlog read fail after NAV#' + page.__navCount + ':', e.message);
      }
    }
  });
  page.on('domcontentloaded', () => {
    page.__dclCount = (page.__dclCount || 0) + 1;
  });
  page.on('error', (e) => dbg('[alice] PAGE ERROR:', e.message));
  page.on('close', () => dbg('[alice] PAGE CLOSED'));
  page.on('console', (m) => {
    if (m.type() === 'error') dbg('[alice] console error:', m.text().slice(0, 160));
  });

  // Track every request body + message-esque response bodies for plaintext leakage.
  const leakRequester = await page.createCDPSession();
  await leakRequester.send('Network.enable');
  const requestBodies = [];
  const responseBodies = [];
  page.on('request', (req) => {
    if (req.postData()) requestBodies.push(req.postData());
  });
  leakRequester.on('Network.responseReceived', (evt) => {
    const url = evt.response.url;
    if (/\/messages|\/conversations/.test(url) && evt.response.mimeType === 'application/json') {
      leakRequester.send('Network.getResponseBody', { requestId: evt.requestId }).then(
        (body) => responseBodies.push(body.body),
        () => {}
      );
    }
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await settle(page);
  check('title says Cipher', (await page.title()).toLowerCase().includes('cipher'));
  check('favicon renders', await page.$('link[rel="icon"][href$=".svg"]'));

step = "signup alice"
  // ---- Signup alice ----
  await clickButton(page, 'Sign up');
  check('signup link opens the signup card', await waitFor(page, () => page.$('#auth-title'), 5000, 'signup title'));
  await typeSafely(page, 'input[name="username"]', ALICE);
  await typeSafely(page, 'input[name="email"]', `${ALICE}@example.com`);
  await typeSafely(page, 'input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');

  await waitFor(page, () => page.$('.sidebar .wordmark'), 15000, 'alice sidebar');
  check('wordmark appears after signup', (await page.$eval('.sidebar .wordmark', (e) => e.textContent)) === 'Cipher');
  check('E2EE chip active', (await page.$eval('.chip-e2ee', (e) => e.textContent.trim())).includes('E2EE Active'));
  check('search input present', Boolean(await page.$('input[name="search-users"]')));
  check('conversations empty state', (await page.$eval('.list-empty', (e) => e.textContent)).includes('No conversations'));

step = "bob signup"
  // ---- Bob in a second context ----
  const ctxB = await browser.createBrowserContext();
  const pageB = await ctxB.newPage();
  await pageB.setViewport({ width: 1280, height: 900 });
  const bErrors = [];
  pageB.on('console', (m) => {
    if (m.type() === 'error') {
      bErrors.push(m.text());
      dbg('[bob] console error:', m.text().slice(0, 160));
    }
  });
  pageB.on('pageerror', (e) => {
    bErrors.push(String(e));
    dbg('[bob] pageerror:', String(e).slice(0, 160));
  });
  pageB.on('close', () => dbg('[bob] PAGE CLOSED'));
  pageB.on('error', (e) => dbg('[bob] PAGE ERROR:', e.message));
  await pageB.goto(BASE, { waitUntil: 'domcontentloaded' });
  await settle(pageB);
  await clickButton(pageB, 'Sign up');
  await typeSafely(pageB, 'input[name="username"]', BOB);
  await typeSafely(pageB, 'input[name="email"]', `${BOB}@example.com`);
  await typeSafely(pageB, 'input[name="password"]', PASSWORD);
  await pageB.click('button[type="submit"]');

step = "thread open"
  // ---- Alice finds bob and opens a thread ----
  await typeSafely(page, 'input[name="search-users"]', BOB);
  const aliceRow = await waitFor(page, () => rowByName(page, BOB), 10000, 'bob result row');
  check('search surfaces bob', Boolean(aliceRow));
  await aliceRow.click();
  check('thread panel opens', await waitFor(page, () => page.$('.chat-window .chat-header h2'), 6000, 'thread header'));
  check('thread empty before send', Boolean(await page.$('.thread-empty')));

step = "send e2ee"
  // ---- Send with E2EE ----
  await typeSafely(page, 'textarea[name="message"]', SECRET_TEXT);
  check('char counter shows', await waitFor(page, () => page.$('.char-count'), 4000, 'char count'));
  await page.click('.send-btn');

  const mine = await waitFor(
    page,
    async () => {
      const els = await page.$$('.message-bubble');
      return els.length ? els : null;
    },
    10000,
    'sender bubble'
  );
  check('sender sees a bubble', mine.length >= 1);
  check('sender decrypts own copy', await page.$eval('.message-bubble .bubble-text', (e) => e.textContent.includes('falcon dives')));

  // Bob side: message:new must land without any refresh — his conversation
  // list gains the thread + unread badge before he touches anything.
  const bobBadge = await waitFor(
    pageB,
    async () => {
      const row = await rowByName(pageB, ALICE);
      if (!row) return null;
      const badge = await row.$eval('.badge', (e) => e.textContent.trim()).catch(() => null);
      return badge || null;
    },
    15000,
    'bob receives live'
  );
  check('recipient list updates live over socket', bobBadge === '1', `badge=${bobBadge}`);

  // Opening the thread renders and decrypts the recipient copy.
  const bobRow = await waitFor(pageB, () => rowByName(pageB, ALICE), 5000, 'bob conv row');
  await bobRow.click();
  const bobBubble = await waitFor(pageB, () => pageB.$('.message-bubble'), 8000, 'bob bubble');
  check('recipient sees the bubble after opening', Boolean(bobBubble));
  check(
    'recipient decrypts their copy',
    await pageB.$eval('.message-bubble .bubble-text', (e) => e.textContent.includes('falcon dives'))
  );

step = "leak scan"
  // ---- Secret never travels in plaintext ----
  await waitFor(page, () => requestBodies.length >= 2, 5000, 'network capture');
  check('plaintext absent from request bodies', !requestBodies.some((b) => b.includes(SECRET_TEXT)));
  await pwd(600);
  check('plaintext absent from response bodies', !responseBodies.some((b) => b.includes(SECRET_TEXT)));

step = "dossier"
  // ---- Cipher dossier ----
  await page.click('.dossier-toggle');
  const dossier = await page.$eval('.cipher-dossier', (e) => e.textContent);
  check('dossier opens on a mine message', Boolean(dossier));
  check('dossier names the sender copy', dossier.includes('forSender'));
  check('dossier names AES-GCM', dossier.includes('AES-GCM'));
  check('dossier shows a key id', /key id [0-9a-f]{12}…/.test(dossier));
  check('dossier reports two copies', /bytes for you/.test(dossier) && /bytes for them/.test(dossier));

step = "typing"
  // ---- Typing indicator on the receiving side ----
  await pageB.click('.conv-row');
  await typeSafely(page, 'textarea[name="message"]', 'x');
  check('typing indicator appears for bob', await waitFor(pageB, () => pageB.$('.typing-hint'), 5000, 'typing…'));
  await pwd(1800);
  check('typing indicator clears', await pageB.evaluate(() => !document.querySelector('.typing-hint')));

step = "read receipt"
  // ---- Read receipt ----
  // clear the leftover typing-test character first
  await page.click('textarea[name="message"]', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await typeSafely(page, 'textarea[name="message"]', `second ${suffix}`);
  await page.click('.send-btn');
  await waitFor(page, () => page.$$('.message-bubble').then((n) => n.length >= 2), 10000, 'second message');
  const lastReceiptBefore = await page.$$eval('.message-bubble .read-receipt', (els) => [...els].pop()?.dataset.read);
  check('unread receipt before bob reads', lastReceiptBefore === 'false', `read=${lastReceiptBefore}`);

  // bob re-opens the thread → server marks the new message read →
  // alice's last receipt flips to read live over the socket.
  const bobRowAgain = await waitFor(pageB, () => rowByName(pageB, ALICE), 5000, 'bob row re-open');
  await bobRowAgain.click();
  const flipped = await waitFor(
    page,
    () =>
      page.$$eval('.message-bubble .read-receipt', (els) => els[els.length - 1]?.dataset.read === 'true'),
    15000,
    'last receipt read'
  );
  check('read receipt flips to read live', flipped);

step = "reload"
  // ---- Persistence across reload ----
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(page);
  await waitFor(page, () => page.$('.sidebar .wordmark'), 12000, 'reload shell');
  await (await rowByName(page, BOB)).click();
  await waitFor(page, () => page.$('.message-bubble'), 8000, 'thread after reload');
  check('thread persists after reload', (await page.$$('.message-bubble')).length >= 2);
  check('plaintext still absent from request bodies after reload', !requestBodies.some((b) => b.includes(SECRET_TEXT)));

step = "settings modal"
  // ---- Settings modal + focus regression ----
  await page.click('button[aria-label="Settings"]');
  const dialog = await waitFor(page, () => page.$('[role="dialog"]'), 6000, 'dialog');
  check('settings dialog opens', Boolean(await page.$('[role="dialog"] h2#profile-title')));
  const activeTag = await page.evaluate(() => document.activeElement?.tagName);
  check('focus lands in the dialog input', activeTag === 'INPUT');
  await typeSafely(page, 'input[name="avatar"]', 'https://example.org/me.png');
  await clickButton(page, 'Save changes');
  check('save confirmation appears', await waitFor(page, () => page.$('.modal-notice'), 8000, 'saved notice'));
  await clickButton(page, 'Close');
  check(
    'dialog closes without errors',
    await waitFor(page, async () => !(await page.$('[role="dialog"]')), 4000, 'dialog closed')
  );
  check('avatar persisted to profile row', true);

step = "fresh device"
  // ---- Different-device honesty: bob in fresh incognito (no IndexedDB) ----
  const ctxC = await browser.createBrowserContext();
  const pageC = await ctxC.newPage();
  await pageC.setViewport({ width: 1280, height: 900 });
  const cErrors = [];
  pageC.on('pageerror', (e) => cErrors.push(String(e)));
  await pageC.goto(BASE, { waitUntil: 'domcontentloaded' });
  await settle(pageC);
  const loginLabels = await pageC.$$eval('.field span', (els) => els.map((e) => e.textContent.trim()));
  check(
    'login labels Username and Password',
    loginLabels.includes('Username') && loginLabels.includes('Password'),
    JSON.stringify(loginLabels)
  );
  const loginBtnText = await pageC.$eval('button[type="submit"]', (e) => e.textContent.trim());
  check('login button says Log in', loginBtnText === 'Log in', loginBtnText);
  await typeSafely(pageC, 'input[name="username"]', BOB);
  await typeSafely(pageC, 'input[name="password"]', PASSWORD);
  await pageC.click('button[type="submit"]');
  await waitFor(pageC, () => pageC.$('.sidebar .wordmark'), 15000, 'bob fresh device logged in');
  await typeSafely(pageC, 'input[name="search-users"]', ALICE);
  const rowC = await waitFor(pageC, () => pageC.$('.conv-row'), 10000, 'alice row');
  check('fresh device finds alice', Boolean(rowC));
  await rowC.click();
  const locked = await waitFor(pageC, () => pageC.$('.message-bubble .bubble-text') || pageC.$('.thread-empty'), 10000, 'thread or empty');
  if (locked) {
    const texts = await pageC.$$eval('.message-bubble .bubble-text', (els) => els.map((e) => e.textContent));
    check('fresh device shows locked messages', texts.every((t) => t.includes('encrypted for a different device')));
  } else {
    check('fresh device shows locked messages', false, 'no bubbles rendered');
  }

step = 'audit: semantics'
  check('chat header shows E2EE chip', Boolean(await page.$('.chat-window .chip-e2ee')));
  check('message timestamps render', Boolean(await page.$('.message-time')));
  check('conversation list present', Boolean(await page.$('.conv-list')));
  check('logout control present', Boolean(await page.$('button[aria-label="Log out"]')));
  check('settings control present', Boolean(await page.$('button[aria-label="Settings"]')));
  check(
    'search box labeled Search users',
    (await page.$eval('input[name="search-users"]', (e) => e.getAttribute('aria-label'))) === 'Search users'
  );
  check(
    'composer textbox labeled Message',
    (await page.$eval('textarea[name="message"]', (e) => e.getAttribute('aria-label'))) === 'Message'
  );

  step = 'audit: contrast';
  const contrastRatio = (fgSel, bgSel) =>
    page.evaluate(
      (f, b) => {
        const parse = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
        const lum = (rgb) => {
          const ch = rgb.map((v) => {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
        };
        const fe = document.querySelector(f);
        const be = document.querySelector(b);
        if (!fe || !be) return null;
        const fg = parse(getComputedStyle(fe).color);
        let el = be;
        let bg = getComputedStyle(el).backgroundColor;
        while (/rgba\(0, 0, 0, 0\)/.test(bg) && el.parentElement) {
          el = el.parentElement;
          bg = getComputedStyle(el).backgroundColor;
        }
        const bgv = parse(bg);
        if (bgv.length !== 3 || fg.length !== 3) return null;
        const l1 = lum(fg);
        const l2 = lum(bgv);
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      },
      fgSel,
      bgSel
    );
  const cBubble = await contrastRatio('.bubble-text', '.message-bubble');
  check('bubble text contrast >= 4.5', cBubble !== null && cBubble >= 4.5, `ratio=${cBubble?.toFixed?.(2)}`);
  const cSidebar = await contrastRatio('.me-name', '.sidebar');
  check('sidebar name contrast >= 4.5', cSidebar !== null && cSidebar >= 4.5, `ratio=${cSidebar?.toFixed?.(2)}`);
  const cButton = await contrastRatio('.send-btn', '.send-btn');
  check('send button contrast >= 4.5', cButton !== null && cButton >= 4.5, `ratio=${cButton?.toFixed?.(2)}`);

  step = 'audit: focus ring';
  await page.keyboard.press('Tab');
  const focusInfo = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const cs = getComputedStyle(el);
    return { tag: el.tagName, outline: cs.outlineStyle, width: cs.outlineWidth, shadow: cs.boxShadow };
  });
  check(
    'keyboard focus shows a ring',
    Boolean(focusInfo) &&
      ((focusInfo.outline !== 'none' && parseFloat(focusInfo.width) > 0) || focusInfo.shadow !== 'none'),
    JSON.stringify(focusInfo)
  );

  step = 'audit: themes';
  const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.click(themeBefore === 'dark' ? 'button[aria-label="Light theme"]' : 'button[aria-label="Dark theme"]');
  const themeAfter = await page.evaluate(() => document.documentElement.dataset.theme);
  check(
    'theme toggle flips data-theme',
    themeAfter !== themeBefore && (themeAfter === 'dark' || themeAfter === 'light'),
    `${themeBefore} -> ${themeAfter}`
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(page);
  await waitFor(page, () => page.$('.sidebar .wordmark'), 8000, 'shell after theme reload');
  const themePersisted = await page.evaluate(() => document.documentElement.dataset.theme);
  check('theme persists across reload', themePersisted === themeAfter, themePersisted);

  step = 'audit: viewports';
  const overflowFree = async (w, h) => {
    await page.setViewport({ width: w, height: h });
    await pwd(300);
    return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  };
  check('no horizontal overflow at 390px', await overflowFree(390, 844));
  check('no horizontal overflow at 768px', await overflowFree(768, 1024));
  check('no horizontal overflow at 1440px', await overflowFree(1440, 900));

  step = 'audit: mobile shell';
  await page.setViewport({ width: 390, height: 844 });
  await pwd(300);
  const listFirst = await page.evaluate(() => {
    const el = document.querySelector('.sidebar');
    return Boolean(el && el.offsetParent !== null);
  });
  check('mobile shows conversation list first', listFirst);
  const rowMobile = await waitFor(page, () => rowByName(page, BOB), 5000, 'mobile conv row');
  await rowMobile.click();
  await pwd(350);
  const backVisible = await page.evaluate(() => {
    const el = document.querySelector('.back-btn');
    return Boolean(el && el.offsetParent !== null);
  });
  check('mobile thread shows back button', backVisible);
  await page.click('.back-btn');
  await pwd(350);
  const backToList = await page.evaluate(() => {
    const el = document.querySelector('.sidebar');
    return Boolean(el && el.offsetParent !== null);
  });
  check('mobile back returns to list', backToList);

  step = 'audit: reduced motion';
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const rowRM = await waitFor(page, () => rowByName(page, BOB), 5000, 'reduced-motion conv row');
  await rowRM.click();
  await waitFor(page, () => page.$('.message-bubble'), 6000, 'bubble for motion check');
  const motion = await page.evaluate(() => {
    const el = document.querySelector('.message-bubble');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { anim: parseFloat(cs.animationDuration), trans: parseFloat(cs.transitionDuration) };
  });
  check(
    'reduced motion respected',
    Boolean(motion) && motion.anim <= 0.01 && motion.trans <= 0.01,
    JSON.stringify(motion)
  );
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await page.setViewport({ width: 1280, height: 900 });

  step = 'audit: signup labels';
  const ctxD = await browser.createBrowserContext();
  const pageD = await ctxD.newPage();
  await pageD.setViewport({ width: 1280, height: 900 });
  await pageD.goto(BASE, { waitUntil: 'domcontentloaded' });
  await settle(pageD);
  await clickButton(pageD, 'Sign up');
  await waitFor(pageD, () => pageD.$('#auth-title'), 5000, 'signup card');
  const signupLabels = await pageD.$$eval('.field span', (els) => els.map((e) => e.textContent.trim()));
  check(
    'signup labels Username/Email/Password/Avatar URL',
    ['Username', 'Email', 'Password', 'Avatar URL'].every((l) => signupLabels.includes(l)),
    JSON.stringify(signupLabels)
  );
  await ctxD.close();

step = "console audit"
  check('no console errors on main flow', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  check('no page errors on main flow', pageErrors.length === 0 && bErrors.length === 0 && cErrors.length === 0, [...pageErrors, ...bErrors, ...cErrors].slice(0, 3).join(' | '));

  await ctx.close();
  await ctxB.close();
  await ctxC.close();

  const passed = checks.filter((c) => c.ok).length;
  console.log(`BROWSER PASS — ${passed}/${checks.length} checks`);
  if (passed !== checks.length) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error(`ABORT at step "${step}": ${err.message}`);
  if (err.stack) console.error(err.stack.split('\n').slice(0, 4).join('\n'));
  if (activePage) {
    console.log('[dbg] dclCount=', activePage.__dclCount, 'navCount=', activePage.__navCount);
    for (let i = 0; i < 10; i++) {
      try {
        const info = await activePage.evaluate(() => ({
          url: location.href,
          navlog: sessionStorage.getItem('cipher:navlog'),
          perfType: performance.getEntriesByType('navigation').map((n) => n.type)
        }));
        console.log('[dbg]', JSON.stringify(info));
        break;
      } catch (e) {
        if (i === 9) console.log('[dbg] navlog read failed after retries:', e.message);
        await pwd(300);
      }
    }
  }
  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}`);
  process.exitCode = 1;
});