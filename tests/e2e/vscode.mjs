import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
const review = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `import {readFileSync} from 'node:fs'; import {parseWhymark} from './src/lib/whymark/parse.ts'; import {buildReviewVM} from './src/lib/view-model.ts'; const doc=parseWhymark(readFileSync('tests/fixtures/multiple-notes.whymark','utf8')); doc.meta.title='<img src=x onerror=alert(1)> literal title'; console.log(JSON.stringify(await buildReviewVM(doc,{isWritable:()=>true})));`], { encoding: 'utf8' }));
const bridge = `window.messages=[]; window.acquireVsCodeApi=()=>({postMessage: m=>{window.messages.push(m); if(m.type==='ready'||m.type==='refresh') fetch('/review').then(r=>r.json()).then(review=>window.postMessage({type:'review',review,revision:window.reviewLoads=(window.reviewLoads||0)+1,trusted:true,label:'Test comparison '+window.reviewLoads,generated:true},'*')); if(m.id) window.postMessage({type:'result',id:m.id,result:{ok:true}},'*');},getState:()=>null,setState:()=>{}});`;
const server = createServer((req,res) => {
  if(req.url==='/review') { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(review)); }
  else if(req.url==='/bridge.js') { res.setHeader('Content-Type','text/javascript'); res.end(bridge); }
  else if(req.url==='/webview.js'||req.url==='/webview.css') { res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript'); res.end(readFileSync(`extensions/vscode/dist${req.url}`)); }
  else res.end(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-test'; style-src 'self' 'unsafe-inline'; connect-src 'self';"><link rel="stylesheet" href="/webview.css"></head><body><div id="root"></div><script nonce="test" src="/bridge.js"></script><script nonce="test" src="/webview.js"></script></body></html>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({viewport:{width:1600,height:1000}});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('heading',{name:'<img src=x onerror=alert(1)> literal title',exact:true}).waitFor();
  assert.equal(await page.locator('img').count(),0,'review HTML is literal text');
  await page.getByRole('button',{name:'Expand all',exact:true}).click();
  assert.equal(await page.locator('[aria-expanded="false"][aria-controls^="comment-body-"]').count(),0);
  await page.getByRole('button',{name:/split/i}).click();
  assert.ok(await page.locator('[data-whymark-side]').count()>=2);
  await page.getByRole('button',{name:'Review settings'}).click();
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  await page.getByTitle('Reject every change in this hunk').first().click();
  await page.getByRole('button',{name:'apply',exact:true}).click();
  await page.waitForFunction(()=>window.messages.some(m=>m.type==='apply'&&m.revision===1));
  await page.getByText('Editor buffer updated:',{exact:false}).waitFor();
  await page.getByLabel('Open source file').selectOption(review.files[0].path);
  await page.getByRole('button',{name:'Save review as…',exact:true}).click();
  await page.getByRole('button',{name:'Open review source',exact:true}).first().click();
  const messages=await page.evaluate(()=>window.messages);
  assert.ok(messages.some(m=>m.type==='open'&&m.path===review.files[0].path));
  assert.ok(messages.some(m=>m.type==='save')); assert.ok(messages.some(m=>m.type==='source'));
  await page.getByRole('button',{name:'Refresh comparison'}).click();
  await page.getByText('Test comparison 2',{exact:true}).waitFor();
  // A valid restricted-mode payload must keep the view while hiding edit controls.
  await page.evaluate(review=>window.postMessage({type:'review',review,revision:3,trusted:false,label:'Restricted',generated:false},'*'),review);
  await page.getByText('Read-only review.',{exact:false}).waitFor();
  await page.keyboard.press('j'); await page.keyboard.press('x');
  assert.equal(await page.getByRole('button',{name:'apply',exact:true}).count(),0);
  assert.deepEqual(errors,[]);
  mkdirSync('.artifacts/vscode',{recursive:true});
  await page.screenshot({path:'.artifacts/vscode/review.png',fullPage:true});
  console.log('PASS bundled webview: literal content, disclosure, split mode, settings, navigation/save/refresh messages, restricted mode, no JS errors');
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
