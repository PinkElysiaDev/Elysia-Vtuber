const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
let id = 1;
const ws = new WebSocket('ws://127.0.0.1:19275');
const call = (m, p) => new Promise((res, rej) => { const rid = id++;
  const on = (raw) => { const x = JSON.parse(String(raw)); if (x.id === rid) { ws.off('message', on); x.error ? rej(new Error(x.error.message)) : res(x.result); } };
  ws.on('message', on); ws.send(JSON.stringify({jsonrpc:'2.0', id:rid, method:m, params:p||{}})); });

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.isDirectory()) copyDir(path.join(src, e.name), path.join(dst, e.name));
    else if (e.isFile()) fs.copyFileSync(path.join(src, e.name), path.join(dst, e.name));
  }
}

function buildFixture() {
  const src = path.resolve('../cpp-executor/build/Debug/Resources/Haru');
  const dst = path.resolve('data/test-models/HaruFixture2');
  fs.rmSync(path.resolve('data/test-models'), { recursive: true, force: true });
  copyDir(src, dst);
  fs.mkdirSync(path.join(dst, "costumes"), { recursive: true });
  // 用已有的表情/动作文件复制到约定目录
  const exprDir = path.join(dst, 'expressions');
  const srcExp = fs.readdirSync(exprDir)[0];
  if (srcExp) {
    fs.copyFileSync(path.join(exprDir, srcExp), path.join(exprDir, 'smile.exp3.json'));
    fs.copyFileSync(path.join(exprDir, srcExp), path.join(dst, 'costumes', 'uniform.exp3.json'));
    // 平铺未分类
    fs.copyFileSync(path.join(exprDir, srcExp), path.join(dst, 'stray_anger.exp3.json'));
  }
  const motionsDir = path.join(dst, 'motions');
  const srcMot = fs.readdirSync(motionsDir)[0];
  if (srcMot) {
    fs.copyFileSync(path.join(motionsDir, srcMot), path.join(motionsDir, 'wave.motion3.json'));
    fs.copyFileSync(path.join(motionsDir, srcMot), path.join(dst, 'stray_dance.motion3.json'));
  }
  return path.join(dst, 'Haru.model3.json').split(path.sep).join('/');
}

(async () => {
  await new Promise(r => ws.once('open', r));
  ws.send(JSON.stringify({jsonrpc:'2.0', method:'peer.declare', params:{kind:'webui'}}));
  await new Promise(r => setTimeout(r, 300));
  const fixture = buildFixture();

  const scan = await call('live2d.assets.scan', { modelPath: fixture });
  console.log('表情:', scan.expressions.map(e => e.name).join(','));
  console.log('换装:', scan.costumes.map(c => c.name).join(','));
  console.log('动作:', scan.motions.map(m => m.name).join(','));
  console.log('未分类:', (scan.uncategorized || []).map(u => u.name + '(' + u.suggestedCategory + ')').join(','));

  const organize = await call('live2d.assets.organize', { modelPath: fixture, moves: [{ file: 'stray_anger.exp3.json', category: 'expression' }] });
  console.log('整理 stray_anger → expressions:', organize.ok);

  const scan2 = await call('live2d.assets.scan', { modelPath: fixture });
  console.log('整理后: 在表情=' + scan2.expressions.some(e => e.name === 'stray_anger') + ' | 在未分类=' + (scan2.uncategorized||[]).some(u => u.name === 'stray_anger'));

  const rename = await call('live2d.assets.rename', { modelPath: fixture, file: 'stray_dance.motion3.json', newName: 'cool_dance' });
  console.log('重命名 stray_dance → cool_dance:', rename.ok, '| newFile:', rename.newFile);

  const scan3 = await call('live2d.assets.scan', { modelPath: fixture });
  console.log('重命名后未分类含 cool_dance:', (scan3.uncategorized||[]).some(u => u.name === 'cool_dance'));

  console.log('--- PASS ---');
  ws.terminate(); process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
