/**
 * Browser smoke test (no extra dependencies): drives headless Chrome/Edge over the DevTools protocol.
 *
 *   npm run build && npm run test:ui
 *
 * - Seeds a throwaway demo database in a temp folder (never touches data/kvcet.db)
 * - Starts the API server (serving dist/) on a free port
 * - Signs in through the real login form (student) and via the login API for other roles
 * - Opens every portal page at desktop and mobile widths
 * - Fails on uncaught exceptions, console errors, failed API calls (5xx) or error banners
 * - Saves screenshots to the folder printed at the end
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'kvcet-ui-'));
const DB = path.join(OUT, 'ui.db');
const PASSWORD = 'Demo@12345';

const BROWSERS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const PAGES = {
  student: ['home', 'raise-complaint', 'complaint-status', 'leave-request', 'leave-request-status', 'outing-permission', 'my-outpass', 'mess-menu', 'notifications', 'profile'],
  warden: ['home', 'student-info', 'leave-requests', 'outing-requests', 'log-book', 'maintenance-complaints', 'attendance', 'incidents', 'room-allocation', 'reports', 'notifications', 'profile'],
  security: ['home', 'qr-scanner', 'log-book', 'notifications', 'profile'],
  hod: ['dashboard', 'students', 'advisers', 'adviser-assignment', 'academics', 'attendance', 'incident-reports', 'leave-requests', 'leave-reports', 'analytics', 'tasks', 'schedule', 'report-requests', 'notifications', 'profile'],
  adviser: ['dashboard', 'students', 'leave-requests', 'academics', 'follow-ups', 'study-log', 'attendance', 'incident-reports', 'reports', 'tasks', 'schedule', 'report-requests', 'notifications', 'profile'],
  ao: ['dashboard', 'incident-reports', 'escalated-cases', 'maintenance', 'reports', 'notifications', 'profile'],
  mess: ['dashboard', 'food-menu', 'student-feedback', 'notifications', 'profile'],
  dean: ['dashboard', 'attendance', 'study', 'academics', 'uninformed-absence', 'hods', 'warden-reports', 'advisers', 'progress', 'assignments', 'schedule', 'report-distribution', 'analytics', 'settings', 'notifications', 'profile'],
  admin: ['users', 'departments', 'class-incharges', 'complaint-config', 'settings', 'audit', 'notifications', 'profile'],
};
const ACCOUNTS = { student: 'student', warden: 'warden', security: 'security', hod: 'hod.cse', adviser: 'adviser.cse1', ao: 'ao', mess: 'mess', dean: 'dean', admin: 'admin' };

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Kills a spawned process tree (shell wrappers on Windows would otherwise leave the child running). */
const killTree = (child) => {
  if (!child?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
};

async function waitFor(url, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.ok) return r;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) this.listeners.forEach((l) => l(msg));
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(fn) {
    this.listeners.push(fn);
  }
}

async function main() {
  const browser = BROWSERS.find((b) => fs.existsSync(b));
  if (!browser) throw new Error('No Chrome/Edge found. Set CHROME_PATH.');
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) throw new Error('Run "npm run build" first.');

  const env = { ...process.env, DB_PATH: DB, NODE_ENV: 'test', LOG_REQUESTS: 'false', DEMO_PASSWORD: PASSWORD };
  // Run TypeScript entry points through node + the tsx loader (no shell, so paths with spaces work).
  const tsNode = (file) => [process.execPath, ['--import', 'tsx', file]];
  const [node, seedArgs] = tsNode('server/cli/seed-demo.ts');
  const seeded = spawnSync(node, seedArgs, { cwd: ROOT, env, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`Seeding failed: ${seeded.stderr}`);

  const port = await freePort();
  const server = spawn(node, tsNode('server.ts')[1], { cwd: ROOT, env: { ...env, PORT: String(port) } });
  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));
  const base = `http://localhost:${port}`;
  await waitFor(`${base}/api/health`);

  const debugPort = await freePort();
  const chrome = spawn(browser, [`--headless=new`, `--remote-debugging-port=${debugPort}`, `--user-data-dir=${path.join(OUT, 'profile')}`, '--no-first-run', '--disable-gpu', 'about:blank']);
  const version = await (await waitFor(`http://127.0.0.1:${debugPort}/json/version`)).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  const cdp = new CDP(ws);

  const failures = [];
  const results = [];
  let current = '';
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => cdp.send(m, p, sessionId);
  await S('Page.enable');
  await S('Runtime.enable');
  await S('Network.enable');
  cdp.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') failures.push(`${current}: uncaught ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
      if (!/Failed to load resource.*(401|404)|favicon/i.test(text)) failures.push(`${current}: console.error ${text.slice(0, 300)}`);
    }
    if (msg.method === 'Network.responseReceived' && msg.params.response.url.includes('/api/') && msg.params.response.status >= 500) {
      failures.push(`${current}: ${msg.params.response.status} ${msg.params.response.url}`);
    }
  });

  const evaluate = async (expression) => {
    const res = await S('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) throw new Error((res.exceptionDetails.exception?.description ?? res.exceptionDetails.text).split(/\r?\n/)[0]);
    return res.result.value;
  };
  const goto = async (url) => {
    await S('Page.navigate', { url });
    await sleep(250);
    // Wait for React to mount: on a cold start the first paint can land after the
    // fixed delay above, which would hand the step an empty document.
    for (let i = 0; i < 60; i++) {
      const mounted = await evaluate(`!!document.querySelector('#root')?.childElementCount`).catch(() => false);
      if (mounted) break;
      await sleep(100);
    }
    // Wait for network-driven content to settle.
    for (let i = 0; i < 40; i++) {
      const busy = await evaluate(`!!document.querySelector('[role=status] .animate-pulse, .animate-spin')`);
      if (!busy) break;
      await sleep(150);
    }
    await sleep(200);
  };
  const shot = async (name) => {
    const { data } = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  };
  const setViewport = (width, height, mobile) => S('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });

  // --- 1. Real login form (student) -------------------------------------------------
  await setViewport(1366, 900, false);
  current = 'login';
  await goto(`${base}/login`);
  await evaluate(`(() => {
    const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    set(document.querySelector('#erp-email-input'), 'wrong@kvcet.edu.in');
    set(document.querySelector('#erp-password-input'), 'nope12345');
    document.querySelector('.erp-submit-btn').click();
  })()`);
  await sleep(1500);
  const loginError = await evaluate(`document.querySelector('[role=alert]')?.textContent ?? ''`);
  results.push(`login: wrong password shows "${loginError.trim()}"`);
  if (!/invalid/i.test(loginError)) failures.push('login: no error shown for wrong credentials');
  await evaluate(`(() => {
    const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    set(document.querySelector('#erp-email-input'), 'student@kvcet.edu.in');
    set(document.querySelector('#erp-password-input'), '${PASSWORD}');
    document.querySelector('.erp-submit-btn').click();
  })()`);
  await sleep(2000);
  const after = await evaluate('location.pathname');
  results.push(`login: student lands on ${after}`);
  if (!after.startsWith('/student')) failures.push(`login: expected /student, got ${after}`);
  await shot('student-after-login');

  // Unauthorized portal URL shows the guard page
  current = 'guard';
  await goto(`${base}/dean`);
  const guard = await evaluate(`document.body.innerText.includes('not authorized')`);
  results.push(`guard: student visiting /dean blocked = ${guard}`);
  if (!guard) failures.push('guard: student could open /dean');

  // --- 2. Every page of every portal ------------------------------------------------
  for (const [portal, tabs] of Object.entries(PAGES)) {
    await evaluate(`fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })`);
    const login = await evaluate(`fetch('/api/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: '${ACCOUNTS[portal]}@kvcet.edu.in', password: '${PASSWORD}' }) }).then(r => r.status)`);
    if (login !== 200) {
      failures.push(`${portal}: login API returned ${login}`);
      continue;
    }
    for (const [label, w, h, mobile] of [
      ['desktop', 1366, 900, false],
      ['mobile', 390, 844, true],
    ]) {
      await setViewport(w, h, mobile);
      for (const tab of tabs) {
        if (label === 'mobile' && !['home', 'dashboard', tabs[1]].includes(tab)) continue;
        current = `${portal}/${tab} (${label})`;
        await goto(`${base}/${portal}/${tab}`);
        const state = await evaluate(`({
          path: location.pathname,
          heading: document.querySelector('main h1, main h2')?.textContent?.trim() ?? '',
          errors: [...document.querySelectorAll('[role=alert]')].map(e => e.textContent.trim()).filter(t => /could not load|unexpected|failed/i.test(t)),
          overflow: document.documentElement.scrollWidth > window.innerWidth + 2,
        })`);
        if (!state.path.startsWith(`/${portal}`)) failures.push(`${current}: redirected to ${state.path}`);
        state.errors.forEach((e) => failures.push(`${current}: error banner "${e.slice(0, 160)}"`));
        if (label === 'mobile' && state.overflow) failures.push(`${current}: horizontal page overflow at 390px`);
        results.push(`${current}: "${state.heading}"`);
        await shot(`${portal}-${tab}-${label}`);
      }
    }
  }

  // --- 3. Cross-portal workflows through the real UI -------------------------------
  await setViewport(1366, 900, false);
  const asUser = async (account) => {
    await evaluate(`fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })`);
    const st = await evaluate(`fetch('/api/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: '${account}@kvcet.edu.in', password: '${PASSWORD}' }) }).then(r => r.status)`);
    if (st !== 200) throw new Error(`login ${account} -> ${st}`);
  };
  // Page helpers: set React-controlled fields, click by visible text, wait for text.
  const HELPERS = `
    window.__set = (el, v) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    };
    window.__field = (label) => {
      const l = [...document.querySelectorAll('label')].find(x => x.textContent.trim().replace(/\\s*\\*$/, '') .startsWith(label));
      if (!l) throw new Error('no label ' + label);
      return l.htmlFor ? document.getElementById(l.htmlFor) : l.querySelector('input,select,textarea');
    };
    window.__click = (text, scope = document) => {
      const el = [...scope.querySelectorAll('button, [role=tab], a, tr, li button')].reverse().find(b => b.textContent.replace(/\\s+/g, ' ').trim().includes(text) && !b.disabled);
      if (!el) throw new Error('no clickable ' + text);
      el.click();
      return true;
    };
  `;
  const step = async (name, js) => {
    current = `flow: ${name}`;
    try {
      await evaluate(`(() => { ${HELPERS} ${js} })()`);
    } catch (err) {
      failures.push(`${current}: ${err.message}`);
    }
    await sleep(900);
  };
  const expectText = async (name, text) => {
    for (let i = 0; i < 20; i++) {
      if (await evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`)) return results.push(`flow: ${name} ✓`);
      await sleep(250);
    }
    failures.push(`flow: ${name}: "${text}" not found`);
  };

  // Flow A: Dean assigns work to all HODs via the form → HOD acknowledges it.
  const title = `UI flow task ${Date.now().toString().slice(-5)}`;
  await asUser('dean');
  await goto(`${base}/dean/assignments`);
  await step('dean opens form', `__click('New assignment')`);
  await step(
    'dean fills form',
    `__set(__field('Task title'), ${JSON.stringify(title)});
     __set(__field('Detailed description'), 'Prepare the department progress note for the hostel review.');
     [...document.querySelectorAll('label')].find(l => l.textContent.includes('All HODs')).querySelector('input').click();`,
  );
  await sleep(800);
  await step('dean reviews', `__click('Review & assign')`);
  await step('dean confirms', `__click('Assign now', document.querySelectorAll('[role=dialog]')[document.querySelectorAll('[role=dialog]').length - 1])`);
  await expectText('assignment created and visible to the Dean', title);
  await shot('flow-dean-assignment');
  await asUser('hod.cse');
  await goto(`${base}/hod/tasks`);
  await expectText('HOD sees the new task', title);
  await step('HOD opens task', `__click(${JSON.stringify(title)})`);
  await step('HOD acknowledges', `__click('Acknowledge task')`);
  await expectText('HOD acknowledgement recorded', 'Acknowledged');
  await shot('flow-hod-task');

  // Flow B: student leave → Class Incharge → HOD → Warden → student sees outpass with QR.
  const day = (n) => {
    const d = new Date(Date.now() + n * 86400000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  await asUser('student');
  await goto(`${base}/student/leave-request`);
  await step(
    'student fills leave form',
    `__set(document.getElementById('leave-type'), 'Medical Leave');
     __set(document.getElementById('leave-from'), '${day(20)}');
     __set(document.getElementById('leave-to'), '${day(21)}');
     __set(document.getElementById('leave-reason'), 'Specialist consultation in Chennai (UI flow test).');`,
  );
  await step('student submits leave', `__click('Submit Leave Request')`);
  await expectText('leave submitted', 'Leave Request Submitted');
  const leaveId = await evaluate(`[...document.querySelectorAll('.font-mono')].map(e => e.textContent).find(t => /^LR-/.test(t)) ?? ''`);
  results.push(`flow: leave id ${leaveId}`);
  await asUser('adviser.cse1');
  await goto(`${base}/adviser/leave-requests`);
  await step('class incharge opens leave row', `[...document.querySelectorAll('tbody tr')].find(r => r.textContent.includes('Medical Leave'))?.click()`);
  await step('class incharge approves', `__click('Approve & forward to HOD')`);
  await asUser('hod.cse');
  await goto(`${base}/hod/leave-requests`);
  await step('HOD opens leave row', `[...document.querySelectorAll('tbody tr')].find(r => r.textContent.includes('Medical Leave'))?.click()`);
  await step('HOD approves', `__click('Approve & forward to Warden')`);
  await asUser('warden');
  await goto(`${base}/warden/leave-requests`);
  await step('warden opens leave', `[...document.querySelectorAll('tbody tr')].find(r => r.textContent.includes('Medical Leave'))?.click()`);
  await step('warden approves', `__click('Approve & issue outpass')`);
  await asUser('student');
  await goto(`${base}/student/my-outpass`);
  await step('student opens outpass', `__click('View Outpass & QR')`);
  await sleep(800);
  const qrOk = await evaluate(`!!document.querySelector('img[alt^="QR code for gate pass"]')`);
  if (qrOk) results.push('flow: approved leave produced an outpass with a QR code ✓');
  else failures.push('flow: no QR outpass visible to the student after approval');
  await shot('flow-student-outpass');

  ws.close();
  killTree(chrome);
  killTree(server);
  console.log(results.join('\n'));
  console.log(`\nScreenshots: ${OUT}`);
  if (failures.length) {
    console.error(`\n${failures.length} problem(s):\n- ${[...new Set(failures)].join('\n- ')}`);
    if (process.env.SHOW_SERVER_LOG) console.error(serverLog);
    process.exit(1);
  }
  console.log(`\nUI smoke test passed (${results.length} checks).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
