// 临时探针：只做「页面到底长什么样」的观测，不做判定。
import { spawn } from 'node:child_process';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HOST = 'default.com', PORT = 9503, PFX = '/AtlanticFleetSite';
const BASE = `http://${HOST}:${PORT}${PFX}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=9333',
  `--host-resolver-rules=MAP ${HOST} 127.0.0.1`, '--no-first-run',
  '--user-data-dir=' + process.env.TEMP + '\\probe9333', 'about:blank'], { stdio: 'ignore' });
await sleep(2500);

const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(); const logs = []; const fails = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled')
    logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
  if (m.method === 'Network.loadingFailed') fails.push(m.params.errorText);
  if (m.method === 'Runtime.exceptionThrown')
    logs.push('EXC: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
};
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.value;

await send('Runtime.enable'); await send('Network.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

for (const url of [`${BASE}/`, `${BASE}/mods/`]) {
  logs.length = 0; fails.length = 0;
  await send('Page.navigate', { url });
  await sleep(4000);
  const info = await ev(`JSON.stringify({
    url: location.href,
    title: document.title,
    ready: (document.documentElement.className||''),
    cards: document.querySelectorAll('.card').length,
    afcard: document.querySelectorAll('.af-card').length,
    topbar: document.querySelectorAll('.af-topbar').length,
    bodyLen: document.body ? document.body.innerHTML.length : 0,
    scripts: [...document.querySelectorAll('script[src]')].map(s=>s.getAttribute('src')),
    styles: [...document.querySelectorAll('link[rel=stylesheet]')].map(s=>s.getAttribute('href')),
    varTok: getComputedStyle(document.documentElement).getPropertyValue('--af-t-base')
  })`);
  console.log('=== ' + url);
  console.log(JSON.stringify(JSON.parse(info), null, 1));
  if (logs.length) console.log('CONSOLE:', logs.slice(0, 12).join(' | '));
  if (fails.length) console.log('NETFAIL:', [...new Set(fails)].slice(0, 8).join(' | '));
}
edge.kill();
process.exit(0);