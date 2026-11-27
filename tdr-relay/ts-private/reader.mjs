import https from 'node:https';
import tls from 'node:tls';
import { createHash, X509Certificate } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { gunzip, inflate, brotliDecompress } from 'node:zlib';
import { setTimeout as pause } from 'node:timers/promises';

const originPin = '560be6b4d0c94651b940705aa0091a3f3524fd05675a004cfab7a315d34dc806';
const intermediatePem = `-----BEGIN CERTIFICATE-----
MIIFxjCCBK6gAwIBAgIQDwa7CTBhSCZ/yhtxwduAfTANBgkqhkiG9w0BAQsFADBh
MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3
d3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBH
MjAeFw0yMjEyMTUwMDAwMDBaFw0zMjEyMTQyMzU5NTlaMFsxCzAJBgNVBAYTAlVT
MRcwFQYDVQQKEw5EaWdpQ2VydCwgSW5jLjEzMDEGA1UEAxMqR2VvVHJ1c3QgRzIg
VExTIENOIFJTQTQwOTYgU0hBMjU2IDIwMjIgQ0ExMIICIjANBgkqhkiG9w0BAQEF
AAOCAg8AMIICCgKCAgEAn1dxOo4OzYa4O1EJd0nhFI5QB/kXAJTHRI6C1J2Gz86B
Ge9+DD8R4vexG7/QnUvV+5887o+G4enlkDwJV1Pehq4i0n+X6VKIPg5cThCx6/o0
3bUkLWld7slhi3Hli/MaosZZuytdU1uCzQlGpaLB2TiTZbDImiVaykdfwl8V6AXP
0Ab4wIcvPggl4qlwyPsBY6NODbP884BmL1ntdXfzecGst30FnAtm4w+PTo0I1T3F
ITYXaNuIJnKonD1xXaN4Ar/rvcpKpntxVyZQ2T1Lb7vlfYISqNF+1ugpTzKnI1z7
xV7tSqXd2vs6Csy6yFN+QLWwMnGWuQkvrO1m+F7V85S9ECpbqn9qNtKl8gIQ7JeZ
BmBdLroW+4j1PDzBWmSWKB+gvRubVSTuoDR3VCtlI4G/Uh+ObF4UStbhKjr1SNCW
JcrB1oF+wWBl8Bvozm4xflyyGDY47KCP/Fn9X5GHDNLQA9R0zqDKRumipp1UXswF
uzH0I+gOuqSdZSsYID9XSVq6adcJ3rIMAcTuODcrPrJssOFKGFUbmY/VxbxMgYHI
/07Zfdxoa+q0osWpofbMhLPZz9UuJFBCLsjgSckkSU02/4itmLm9e3lt6E/4q9Mc
MCaS8+qrLWKG9wQtviC8zGynEXpxjEQE8WyrfeYKyXwZFCPB4rpTw1joJmGFeLUC
AwEAAaOCAX4wggF6MBIGA1UdEwEB/wQIMAYBAf8CAQAwHQYDVR0OBBYEFEFOjmmd
9G4l7HgUHH7XzR2Zz/lrMB8GA1UdIwQYMBaAFE4iVCAYlebjbuYP+vq5Eu0GF485
MA4GA1UdDwEB/wQEAwIBhjAdBgNVHSUEFjAUBggrBgEFBQcDAQYIKwYBBQUHAwIw
dAYIKwYBBQUHAQEEaDBmMCMGCCsGAQUFBzABhhdodHRwOi8vb2NzcC5kaWdpY2Vy
dC5jbjA/BggrBgEFBQcwAoYzaHR0cDovL2NhY2VydHMuZGlnaWNlcnQuY24vRGln
aUNlcnRHbG9iYWxSb290RzIuY3J0MEAGA1UdHwQ5MDcwNaAzoDGGL2h0dHA6Ly9j
cmwuZGlnaWNlcnQuY24vRGlnaUNlcnRHbG9iYWxSb290RzIuY3JsMD0GA1UdIAQ2
MDQwCwYJYIZIAYb9bAIBMAcGBWeBDAEBMAgGBmeBDAECATAIBgZngQwBAgIwCAYG
Z4EMAQIDMA0GCSqGSIb3DQEBCwUAA4IBAQAkpDVI+nCKnAEEpDfldytHXUYOr2ys
aGeboE3d1KAN4Gt+eioRvgNdmDKbVFCYY0C6ErIXIvSGXafsprU2dclka/kmH+9U
4q3v5Acx6KwcnEuYLN0QOtrlQ9s3Z4IbIzdYUv8IauXC27a3x99x2WMVxNu1KGJy
0r1Z+Xya1adf9/e1LFj1CGdq9HfQ/HFWP2khzxQZ4u62sOHuZdPgtNidFOhQLC+2
5cNsPgqsaCrGLbSjzni7VN7NhAbTsLhA1oz41vHHB+q4ZzNlC01elmPBOtupe2HM
/lqMA/J/nTxc718THdxpszFllAET1/lFEolnqihpUFPaPjRwU7yZIseS
-----END CERTIFICATE-----`;
const maximumFile = 28 * 1024 * 1024;
const zipMagic = Buffer.from([0x50, 0x4b, 3, 4]);
const numberText = '(\\d[\\d,]*)';
const messageNoData = /^(?:no (?:data|records|results)(?:\s+(?:found|available|to (?:display|retrieve)))?|there (?:is|are) no (?:data|records|results)(?: to (?:display|retrieve))?)[.!\s]*$/i;
const controls = ['loading','vvd','port','call','local','ts','search','export'];
const safeText = value => typeof value === 'string' && value.trim() && value.length <= 120 && !/[<>\r\n\0]/.test(value);

export class ReadError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fault = (status, code, message) => new ReadError(status, code, message);

export function validateConfig(c) {
  if (!c || createHash('sha256').update(String(c.origin)).digest('hex') !== originPin ||
      !['mainPath','reportPath','loginPath'].every(k => /^\/[A-Za-z0-9_./-]+$/.test(c[k]) && !c[k].includes('..') && !c[k].includes('//')) ||
      !Array.isArray(c.menuLabels) || c.menuLabels.length !== 3 || !c.menuLabels.every(safeText) ||
      !controls.every(k=>/^#[a-zA-Z][a-zA-Z0-9_-]{0,64}$/.test(c.controls?.[k])) ||
      !safeText(c.headers?.size) || !safeText(c.headers?.ts)) throw fault(400,'reader_config','清单读取配置无效。');
  return c;
}

function suppliedCookies(input, domain) {
  if (!Array.isArray(input) || !input.length || input.length > 80) throw fault(401,'login_required','请登录后再查询。');
  return input.map(cookie => {
    if (!/^[\w.-]{1,80}$/.test(cookie?.name) || typeof cookie.value !== 'string' ||
        cookie.value.length > 4096 || /[^\x21-\x7e]|[;,]/.test(cookie.value)) throw fault(401,'login_required','登录会话格式无效。');
    return {name:cookie.name,value:cookie.value,domain,path:'/',secure:true,httpOnly:true,sameSite:'Lax'};
  });
}

function verifiedCA() {
  const member = new X509Certificate(intermediatePem);
  const now = Date.now();
  if (!member.ca || Date.parse(member.validFrom)>now || Date.parse(member.validTo)<now ||
      !tls.rootCertificates.some(pem => {
        const root = new X509Certificate(pem);
        return member.checkIssued(root) && member.verify(root.publicKey);
      })) throw fault(502,'source_tls','系统证书校验失败。');
  return [...tls.rootCertificates, intermediatePem];
}

function isPermittedUrl(value, origin) {
  try {
    const u = new URL(value);
    return u.origin===origin && !u.username && !u.password;
  } catch { return false; }
}

async function requestPage(agent, request, origin) {
  const rawURL = request.url();
  if (!isPermittedUrl(rawURL,origin) || !['GET','POST','HEAD'].includes(request.method())) throw new Error('invalid target');
  const url = new URL(rawURL);
  const headers = {...await request.allHeaders(), 'accept-encoding':'identity'};
  for (const key of Object.keys(headers)) {
    if (key.startsWith(':') || ['connection','content-length','host','proxy-authorization','transfer-encoding','upgrade'].includes(key)) delete headers[key];
  }
  const data = request.postDataBuffer();
  if (data?.length > 256*1024) throw new Error('request size');
  const response = await new Promise((resolve,reject) => {
    const req = https.request(url,{method:request.method(),agent,headers,signal:AbortSignal.timeout(32000)}, resolve);
    req.once('error',reject); req.end(data);
  });
  const chunks = []; let total = 0;
  for await (const chunk of response) {
    total+=chunk.length;
    if (total>maximumFile) { response.destroy(); throw new Error('response size'); }
    chunks.push(chunk);
  }
  const out = {...response.headers};
  if (out.location && !isPermittedUrl(new URL(out.location,url).href,origin)) throw new Error('redirect outside source');
  let body=Buffer.concat(chunks);
  const decompress={gzip:gunzip,br:brotliDecompress,deflate:inflate}[out['content-encoding']];
  if (decompress) body=await promisify(decompress)(body,{maxOutputLength:maximumFile});
  else if (out['content-encoding'] && out['content-encoding']!=='identity') throw new Error('unsupported encoding');
  const cookies = out['set-cookie'] || [];
  for (const key of ['set-cookie','transfer-encoding','content-encoding','content-length','connection','keep-alive','trailer']) delete out[key];
  for (const [k,v] of Object.entries(out)) out[k]=Array.isArray(v)?v.join(', '):String(v);
  return {status:response.statusCode,headers:out,body,cookies};
}

async function applySourceCookies(ctx, items, rawUrl) {
  const url=new URL(rawUrl);
  const collected=[];
  for (const text of items) {
    const parts=text.split(';').map(v=>v.trim());
    const eq=parts[0].indexOf('=');
    if (eq<1) continue;
    const name=parts[0].slice(0,eq), value=parts[0].slice(eq+1);
    if (!/^[\w.-]{1,80}$/.test(name)) continue;
    const attrs={};
    for (const attr of parts.slice(1)) {const i=attr.indexOf('=');attrs[(i<0?attr:attr.slice(0,i)).toLowerCase()]=i<0?true:attr.slice(i+1);}
    let expires;
    if (attrs['max-age']!=null && /^-?\d+$/.test(attrs['max-age'])) expires=Math.max(1,Math.min(253402300799,Math.floor(Date.now()/1000)+Number(attrs['max-age'])));
    else if (attrs.expires) {const stamp=Date.parse(attrs.expires);if (Number.isFinite(stamp)) expires=Math.max(1,Math.floor(stamp/1000));}
    collected.push({name,value,domain:url.hostname,path:typeof attrs.path==='string'&&attrs.path.startsWith('/')?attrs.path:url.pathname.slice(0,url.pathname.lastIndexOf('/')+1)||'/',
      secure:true,httpOnly:!!attrs.httponly, ...(expires===undefined?{}:{expires})});
  }
  if (collected.length) await ctx.addCookies(collected);
}

export function normalizeTime(value) {
  const source=String(value??'').trim().replace('T',' ');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::00)?$/.test(source)) return null;
  const s=source.slice(0,16);
  const d=new Date(s.replace(' ','T')+':00Z');
  return Number.isFinite(d.valueOf()) && d.toISOString().slice(0,16).replace('T',' ')===s ? s:null;
}

export function chooseCall(times, expected) {
  const options=Array.from(new Set(times.map(normalizeTime).filter(Boolean)));
  if (!options.length) throw fault(409,'no_calls','没有可识别的靠次。');
  const want=normalizeTime(expected);
  const indices=times.map((v,i)=>normalizeTime(v)===want && want ? i:-1).filter(i=>i>=0);
  if (!indices.length) return {kind:'choose',options};
  if (indices.length!==1) throw fault(409,'ambiguous_call','有重复时间的靠次，请核实靠次。');
  return {kind:'selected',call:want,index:indices[0]};
}

export function readCounts(tsText, sizeText) {
  const local=tsText.match(new RegExp('\\bLocal\\s*:\\s*'+numberText,'i'));
  const ts=tsText.match(new RegExp('\\bT\\s*/\\s*S\\s*:\\s*'+numberText,'i'));
  if (!local || !ts) return null;
  const num=s=>Number(s.replaceAll(',',''));
  if (num(local[1])) throw fault(409,'mixed_local','原系统返回了 Local 箱，未计入汇总。');
  const boxes=num(ts[1]); let checked=0, teu=0;
  const seen=new Set();
  for (const [,size,text] of sizeText.matchAll(/\b(\d{2})\s*['′’]\s*:\s*(\d[\d,]*)/g)) {
    if (seen.has(size)) return null;
    seen.add(size); const n=num(text); checked+=n;
    if (n && !['20','40','45'].includes(size)) throw fault(422,'unknown_size','原系统含未识别箱长。');
    teu+=n*(size==='20'?1:2);
  }
  if (checked!==boxes) return null;
  return {boxes,teu};
}

async function getFrame(page,cfg) {
  const exact=cfg.origin+cfg.reportPath;
  const until=Date.now()+15000;
  while (Date.now()<until) {
    if (new URL(page.url()).pathname===cfg.loginPath || await page.locator('input[type=password]:visible').count()) throw fault(401,'login_required','登录会话已过期，请重新登录。');
    for (const frame of page.frames()) {
      if (frame.url().split(/[?#]/,1)[0]===exact && await frame.locator(cfg.controls.vvd).isVisible()) return frame;
    }
    await pause(150);
  }
  throw fault(503,'report_unavailable','未能打开装卸清单。');
}

async function findMenuItem(page,name) {
  for (const item of [page.getByRole('button',{name,exact:true}),page.getByRole('link',{name,exact:true}),page.getByText(name,{exact:true})]) {
    const matches=await item.filter({visible:true}).all();
    if (matches.length===1) {await matches[0].click({timeout:5000});return;}
  }
  throw fault(403,'report_unavailable','当前账号未能打开装卸清单。');
}
async function openReport(page,cfg) {
  await page.goto(cfg.origin+cfg.mainPath,{waitUntil:'domcontentloaded',timeout:35000});
  if (new URL(page.url()).pathname===cfg.loginPath || await page.locator('input[type=password]:visible').count()) throw fault(401,'login_required','登录会话已过期，请重新登录。');
  let frame=page.frames().find(f=>f.url().split(/[?#]/,1)[0]===cfg.origin+cfg.reportPath);
  if (frame && await frame.locator(cfg.controls.vvd).isVisible()) return frame;
  await page.getByRole('button',{name:'Menu',exact:true}).click({timeout:10000});
  for (const label of cfg.menuLabels) await findMenuItem(page,label);
  return getFrame(page,cfg);
}
async function inputCodes(frame,C,vvd,port) {
  await frame.locator(C.loading).check();
  for (const [selector,value] of [[C.vvd,vvd],[C.port,port]]) {
    const input=frame.locator(selector);
    await input.fill('');await input.pressSequentially(value,{delay:55});await input.press('Tab');
  }
  const until=Date.now()+24500; let stable=null, stamp=0;
  while (Date.now()<until) {
    const labels=await frame.locator(C.call+' option').allTextContents();
    const sig=JSON.stringify(labels);
    if (labels.some(v=>normalizeTime(v)) && await frame.locator(C.vvd).inputValue()===vvd && await frame.locator(C.port).inputValue()===port) {
      if (stable===sig && Date.now()-stamp>=500) return labels;
      if (stable!==sig) {stable=sig;stamp=Date.now();}
    }
    await pause(170);
  }
  throw fault(409,'no_calls','原系统未列出此航次和中转港的靠次。');
}

async function checkForm(frame,C,vvd,port,time) {
  const [gotVvd,gotPort,selected,loading,local,ts]=await Promise.all([
    frame.locator(C.vvd).inputValue(),frame.locator(C.port).inputValue(),frame.locator(C.call+' option:checked').allTextContents(),frame.locator(C.loading).isChecked(),frame.locator(C.local).isChecked(),frame.locator(C.ts).isChecked()]);
  if (gotVvd!==vvd || gotPort!==port || selected.length!==1 || normalizeTime(selected[0])!==time || !loading || local || !ts) throw fault(409,'selection_changed','原系统的查询条件已改变。');
}

async function summaryRow(frame,label) {
  const rows=frame.getByRole('row').filter({has:frame.getByRole('rowheader',{name:label,exact:true})});
  return await rows.count()===1 && await rows.isVisible() ? (await rows.innerText()).replaceAll('\u00a0',' ') : '';
}
async function exportCall(page,cfg,input) {
  const frame=await openReport(page,cfg);
  const C=cfg.controls, {vvd,port}=input;
  const pick=chooseCall(await inputCodes(frame,C,vvd,port),input.expectedCall);
  if (pick.kind==='choose') return pick;
  const {call,index}=pick;
  await frame.locator(C.call).selectOption({index});
  await frame.locator(C.local).uncheck();await frame.locator(C.ts).check();
  await checkForm(frame,C,vvd,port,call);
  const readText=()=>Promise.all([summaryRow(frame,cfg.headers.ts),summaryRow(frame,cfg.headers.size)]);
  const prior=JSON.stringify(await readText());
  let emptyAlert=false, settled=false;
  const pending=new Set();
  const onStart=req=>{if (['xhr','fetch'].includes(req.resourceType())&&req.frame()===frame&&isPermittedUrl(req.url(),cfg.origin)) {pending.add(req);settled=false;}};
  const onFinish=async req=>{if (pending.delete(req)){const res=await req.response().catch(()=>null);if(res?.ok()&&!pending.size) settled=true;}};
  const onDialog=async dlg=>{if(messageNoData.test(dlg.message().trim())) emptyAlert=true;await dlg.dismiss().catch(()=>{});};
  const visibleEmpty=()=>frame.getByText(messageNoData).filter({visible:true}).count();
  const initialEmpty=await visibleEmpty();
  page.on('request',onStart);page.on('requestfinished',onFinish);page.on('dialog',onDialog);
  try {
    await frame.locator(C.search).click();
    const end=Date.now()+38000;let sums;
    const cargoRows=frame.getByRole('row',{name:new RegExp('^\\s*\\d+\\s+.*\\b'+vvd+'\\b','i')});
    while (Date.now()<end) {
      const texts=await readText();
      if (JSON.stringify(texts)!==prior || settled || emptyAlert) {
        const counts=readCounts(...texts);
        if (counts?.boxes>0 && await cargoRows.count()) {sums=counts;break;}
        if ((!counts || counts.boxes===0) && (emptyAlert || await visibleEmpty() && (!initialEmpty || settled))) {sums={boxes:0,teu:0};break;}
      }
      await pause(250);
    }
    if (!sums) throw fault(504,'unconfirmed','未能核对原系统查询后的箱量。');
    await checkForm(frame,C,vvd,port,call);
    if (!sums.boxes) return {kind:'empty',...sums,call};
    const [download]=await Promise.all([page.waitForEvent('download',{timeout:42000}),frame.locator(C.export).click()]);
    try {
      if (!/\.xlsx$/i.test(download.suggestedFilename()) || await download.failure()) throw fault(502,'download_failed','未能取得原生清单。');
      const path=await download.path();
      if (!path || (await stat(path)).size>maximumFile) throw fault(413,'workbook_size','原生清单大小超出限制。');
      const bytes=await readFile(path);
      if (!isXlsx(bytes)) throw fault(502,'invalid_workbook','原生文件不是有效 Excel。');
      return {kind:'file',call,bytes,...sums};
    } finally {await download.delete().catch(()=>{});}
  } finally {page.off('request',onStart);page.off('requestfinished',onFinish);page.off('dialog',onDialog);}
}

export function isXlsx(data) {
  return Buffer.isBuffer(data) && data.subarray(0,4).equals(zipMagic) && data.includes(Buffer.from('xl/workbook.xml')) &&
    data.includes(Buffer.from('[Content_Types].xml')) && data.includes(Buffer.from('xl/worksheets/')) && data.lastIndexOf(Buffer.from([0x50,0x4b,5,6]))>=0;
}

async function useBrowser(cfg, jar, execute) {
  const [{chromium}, {default:binary}]=await Promise.all([import('playwright-core'),import('@sparticuz/chromium')]);
  binary.setGraphicsMode=false;
  const executablePath=await binary.executablePath();
  const agent=new https.Agent({keepAlive:true,maxSockets:16,ca:verifiedCA(),rejectUnauthorized:true});
  let browser,ctx,timer;
  try {
    browser=await chromium.launch({executablePath,args:binary.args.filter(arg=>!['--ignore-certificate-errors','--disable-web-security','--allow-running-insecure-content','--disable-site-isolation-trials'].includes(arg) && !arg.startsWith('--disable-features=')),headless:true,timeout:35000});
    ctx=await browser.newContext({acceptDownloads:true,locale:'en-US',serviceWorkers:'block',viewport:{width:1440,height:960}});
    await ctx.addCookies(jar);
    await ctx.route('**/*',async route=>{
      const req=route.request();
      if (!isPermittedUrl(req.url(),cfg.origin) || ['image','media','font'].includes(req.resourceType())) return route.abort().catch(()=>{});
      try {
        const res=await requestPage(agent,req,cfg.origin);
        if (res.cookies.length) await applySourceCookies(ctx,res.cookies,req.url());
        await route.fulfill({status:res.status,headers:res.headers,body:res.body});
      } catch {await route.abort().catch(()=>{});}
    });
    await ctx.routeWebSocket(/.*/, ws=>ws.close());
    const page=await ctx.newPage();page.setDefaultTimeout(12000);
    return await Promise.race([execute(page),new Promise((_,reject)=>{timer=setTimeout(()=>reject(fault(504,'query_timeout','原系统查询超时，请重试。')),154000);})]);
  } catch (error) {
    if (error instanceof ReadError) throw error;
    throw fault(502,'native_query_failed','未能核对原生装船清单。');
  } finally {
    clearTimeout(timer);agent.destroy();
    if (ctx) await ctx.close().catch(()=>{});
    if (browser) await browser.close().catch(()=>{});
  }
}


export async function readManifest(input, rawConfig) {
  const cfg=validateConfig(rawConfig);
  if (!/^[A-Z0-9]{4,16}$/.test(input?.vvd) || !/^[A-Z]{2}[A-Z0-9]{3}$/.test(input.port)) throw fault(400,'bad_selection','航次或港口格式无效。');
  const jar=suppliedCookies(input.cookies,new URL(cfg.origin).hostname);
  return useBrowser(cfg,jar,page=>exportCall(page,cfg,input));
}

export async function probeLanding(rawConfig) {
  const cfg=validateConfig(rawConfig);
  return useBrowser(cfg,[],async page=>{
    const response=await page.goto(cfg.origin+cfg.loginPath,{waitUntil:'domcontentloaded',timeout:30000});
    if (!response?.ok() || new URL(page.url()).origin!==cfg.origin || !await page.locator('input[type=password]:visible').count()) {
      throw fault(502,'landing_unverified','未能打开来源系统的登录页面。');
    }
    return {browser:true,landing:true};
  });
}
