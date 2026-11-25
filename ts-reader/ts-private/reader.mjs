import https from 'node:https';
import {workbookFromVisibleGrid} from './grid-report.mjs';
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

async function requestPage(agent, request, origin, requestLimit=256*1024) {
  const rawURL = request.url();
  if (!isPermittedUrl(rawURL,origin) || !['GET','POST','HEAD'].includes(request.method())) throw new Error('invalid target');
  const url = new URL(rawURL);
  const headers = {...await request.allHeaders(), 'accept-encoding':'gzip, br, deflate'};
  for (const key of Object.keys(headers)) {
    if (key.startsWith(':') || ['connection','content-length','host','proxy-authorization','transfer-encoding','upgrade'].includes(key)) delete headers[key];
  }
  const data = request.postDataBuffer();
  if (request.method()==='POST' && data!=null) headers['content-length']=String(data.length);
  if (data?.length > requestLimit) throw new Error('request size');
  const response = await new Promise((resolve,reject) => {
    const req = https.request(url,{method:request.method(),agent,headers,signal:AbortSignal.timeout(75000)}, resolve);
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
  if (body.length) {
    const encoding=String(out['content-encoding'] || 'identity').trim().toLowerCase();
    const decompress={gzip:gunzip,br:brotliDecompress,deflate:inflate}[encoding];
    if (decompress) body=await promisify(decompress)(body,{maxOutputLength:maximumFile});
    else if (encoding!=='identity') throw new Error('unsupported encoding');
  }
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

function completeCalls(times) {
  const active=[], seen=new Set();
  for (const [index,raw] of times.entries()) {
    // Disabled options are supplied as null; other nonempty unknown labels
    // could be real calls and prevent a complete, automatic match.
    if (raw==null || /^(?:|[-–—\s]+|(?:please\s+)?select(?:\s+an?\s+(?:option|call))?[.\s…]*)$/i.test(String(raw).trim())) continue;
    const call=normalizeTime(raw);
    if (!call || seen.has(call) || active.length>=200) return null;
    active.push({call,index}); seen.add(call);
  }
  return active.sort((a,b)=>a.call<b.call?-1:a.call>b.call?1:0);
}

function nearestCall(active, want) {
  const asTime=call=>Date.parse(call.replace(' ','T')+':00Z');
  const scheduled=asTime(want);
  let best, smallest=Infinity;
  for (const entry of active) {
    const gap=Math.abs(asTime(entry.call)-scheduled);
    if (gap<smallest) {best=entry;smallest=gap;}
    else if (gap===smallest) best=null;
  }
  return best;
}

export function chooseCall(times, expected, allowSole=false, allowNearest=false) {
  const options=Array.from(new Set(times.map(normalizeTime).filter(Boolean)));
  if (!options.length) throw fault(409,'no_calls','没有可识别的靠次。');
  const want=normalizeTime(expected);
  const indices=times.map((v,i)=>normalizeTime(v)===want && want ? i:-1).filter(i=>i>=0);
  if (!indices.length) {
    const active=completeCalls(times);
    if (allowSole && want && active?.length===1) return {kind:'selected',...active[0],resolvedSole:true};
    if (allowNearest && want && active?.length>1) {
      const closest=nearestCall(active,want);
      if (closest) return {kind:'selected',...closest,resolvedNearest:true,nativeCalls:active.map(entry=>entry.call)};
    }
    if (options.length===1 && active?.length!==1) {
      throw fault(409,'ambiguous_call','原系统的靠次重复或格式不明，请核实靠次。');
    }
    return {kind:'choose',options};
  }
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

function explicitZeroTotals(tsText,sizeText) {
  if (!/\bLocal\s*:\s*0(?![\d.,])\s*\/?\s*T\s*\/\s*S\s*:\s*0(?![\d.,])/i.test(tsText)) return false;
  const matched=[...sizeText.matchAll(/\b(\d{2})\s*['′’]\s*:\s*(\d[\d,]*)/g)];
  return matched.some(([,size])=>size==='20') && matched.some(([,size])=>size==='40') &&
    matched.every(([,,quantity])=>quantity==='0') && readCounts(tsText,sizeText)?.boxes===0;
}

// The first body row can be a split-pane group/spacer. Real source rows
// have a displayed numeric row ordinal, even if another VVD is rendered.
async function hasContainerRows(frame,cargoRows) {
  if (await cargoRows.count()) return true;
  return frame.locator('.grid-left-pnl .grid-body-pnl tr').evaluateAll(rows=>rows.some(row=>
    row.getClientRects().length && row.cells.length>1 &&
    Array.from(row.cells).some((cell,index)=>index<2 && /^\d+$/.test(cell.innerText.trim()))));
}

function reportFrames(page,cfg) {
  return page.frames().filter(frame=>frame.url().split(/[?#]/,1)[0]===cfg.origin+cfg.reportPath);
}
async function visibleReport(frame,cfg) {
  if (frame.isDetached()) return false;
  // A native tab can keep its report DOM mounted inside a hidden iframe.
  for (let owner=frame; owner.parentFrame(); owner=owner.parentFrame()) {
    const host=await owner.frameElement();
    try { if (!await host.isVisible()) return false; } finally { await host.dispose(); }
  }
  return await frame.locator(cfg.controls.vvd).isVisible() && await frame.locator(cfg.controls.search).isVisible();
}
async function signedOut(page,cfg) {
  return new URL(page.url()).pathname===cfg.loginPath || await page.locator('input[type=password]:visible').count()>0;
}
async function getFrame(page,cfg,timeout=20000) {
  const until=Date.now()+timeout;
  let found=false;
  while(Date.now()<until && !page.isClosed()) {
    if(await signedOut(page,cfg).catch(()=>false)) throw fault(401,'login_required','登录会话已过期，请重新登录。');
    const frames=reportFrames(page,cfg);
    found ||= Boolean(frames.length);
    const active=[];
    for (const frame of frames) {
      if (await visibleReport(frame,cfg).catch(()=>false)) active.push(frame);
    }
    if(active.length===1) return active[0];
    await pause(150);
  }
  if(found) throw fault(503,'form_not_ready','装卸清单表单尚未就绪。');
  throw fault(503,'report_unavailable','未能打开装卸清单。');
}
async function clickMenuItem(page,cfg,name,root=false) {
  const timeout=Date.now()+(root ? 45000 : 12000);
  while(Date.now()<timeout) {
    if(await signedOut(page,cfg)) throw fault(401,'login_required','登录会话已过期，请重新登录。');
    const controls=[page.getByRole('button',{name,exact:true}),page.getByRole('link',{name,exact:true}),
      page.getByRole('menuitem',{name,exact:true}), page.getByText(name,{exact:true})];
    for(const control of controls) {
      const match=control.filter({visible:true});
      if(await match.count()===1) {
        try {await match.click({timeout:4000});return;}
        catch {throw fault(503,root?'shell_unavailable':'menu_unavailable','Allegro 菜单暂时不可用。');}
      }
    }
    await pause(150);
  }
  throw fault(503,root?'shell_unavailable':'menu_unavailable','未能找到 Allegro 菜单项目。');
}
async function openReport(page,cfg,stage) {
  stage('shell');
  const shell=await page.goto(cfg.origin+cfg.mainPath,{waitUntil:'commit',timeout:35000}).catch(()=>null);
  if(await signedOut(page,cfg)) throw fault(401,'login_required','登录会话已过期，请重新登录。');
  if(!shell?.ok()) throw fault(503,'shell_unavailable','未能打开 Allegro 主页面。');
  if(reportFrames(page,cfg).length) return getFrame(page,cfg);
  await clickMenuItem(page,cfg,'Menu',true);
  stage('menu');
  for(const label of cfg.menuLabels) await clickMenuItem(page,cfg,label);
  stage('report');
  return getFrame(page,cfg);
}
function callLabels(frame, selector) {
  return frame.locator(selector+' option').evaluateAll(options=>options.map(option=>
    option.disabled || option.closest('optgroup')?.disabled ? null : option.textContent));
}
const fieldTimeout=10000;
async function selectLoading(frame,C) {
  const radio=frame.locator(C.loading);
  const options={timeout:fieldTimeout};
  await radio.waitFor({state:'attached',...options});
  if (await radio.isChecked(options)) return;
  const label=frame.locator('label[for="'+C.loading.slice(1)+'"]').filter({visible:true});
  if (await label.count()===1) await label.click(options);
  else await radio.check(options);
  if (!await radio.isChecked(options)) throw new Error('mode');
}
async function enterCode(frame,selector,value,origin,checkAlert) {
  const input=frame.locator(selector);
  const options={timeout:fieldTimeout};
  const page=frame.page(), pending=new Set();
  let changed=Date.now();
  // Each native code lookup can disable/replace the next control. Observe only
  // the official report frame's own lookup traffic, allowing cache-only lookups.
  const started=req=>{
    if (['xhr','fetch'].includes(req.resourceType()) && isPermittedUrl(req.url(),origin) && req.frame()===frame) {
      pending.add(req);
      changed=Date.now();
    }
  };
  const finished=req=>{if (pending.delete(req)) changed=Date.now();};
  page.on('request',started);page.on('requestfinished',finished);page.on('requestfailed',finished);
  try {
    // Ordinary native actions: wait out overlays and readonly lookup states.
    await input.click(options);
    checkAlert();
    // Replacing the complete code never leaves a blank or partially typed voyage
    // for native validation. Replacing its final selected character with itself
    // also raises the normal printable-key event that some code lookups require.
    await input.fill(value,options);
    checkAlert();
    await input.press('End',options);
    await input.press('Shift+ArrowLeft',options);
    await input.pressSequentially(value.slice(-1),options);
    checkAlert();
    if (await input.inputValue(options)!==value) throw new Error('input not accepted');
    await input.press('Tab',options);
    changed=Date.now();
    const until=changed+fieldTimeout;
    while (pending.size || Date.now()-changed<450) {
      checkAlert();
      if (frame.isDetached() || Date.now()>=until) throw new Error('lookup still initializing');
      await pause(90);
    }
    checkAlert();
    if (await input.inputValue(options)!==value) throw new Error('input not accepted');
  } finally {
    page.off('request',started);page.off('requestfinished',finished);page.off('requestfailed',finished);
  }
}
async function prepareCriteria(page,cfg,frame,vvd,port,stage) {
  const C=cfg.controls;
  for (let attempt=0;;attempt++) {
    let code='form_not_ready', rejected='';
    const onDialog=dialog=>{
      // Dismiss without accepting native validation/confirmation actions; the
      // search is ineligible until a complete attempt passes without an alert.
      rejected ||= code;
      void dialog.dismiss().catch(()=>{});
    };
    const checkAlert=()=>{if (rejected) throw new Error('Allegro rejected the form input');};
    page.on('dialog',onDialog);
    try {
      if (attempt) frame=await getFrame(page,cfg,10000);
      code='mode_not_ready'; stage('criteria_mode');
      await selectLoading(frame,C);
      checkAlert();
      code='voyage_not_ready'; stage('criteria_voyage');
      await enterCode(frame,C.vvd,vvd,cfg.origin,checkAlert);
      code='port_not_ready'; stage('criteria_port');
      await enterCode(frame,C.port,port,cfg.origin,checkAlert);
      code='form_not_ready'; stage('criteria_calls');
      const until=Date.now()+24500; let stable=null, stamp=0;
      while (Date.now()<until) {
        checkAlert();
        const [voyage,hub]=await Promise.all([frame.locator(C.vvd).inputValue({timeout:1500}),frame.locator(C.port).inputValue({timeout:1500})]);
        if (voyage!==vvd || hub!==port) {
          code=voyage!==vvd?'voyage_not_ready':'port_not_ready';
          throw new Error('lookup changed the criteria');
        }
        if (!await visibleReport(frame,cfg) || !(await frame.locator(C.call).count())) throw new Error('form replaced');
        const labels=await callLabels(frame,C.call);
        const sig=JSON.stringify(labels);
        if (labels.some(v=>normalizeTime(v))) {
          if (stable===sig && Date.now()-stamp>=500) return {frame,labels};
          if (stable!==sig) {stable=sig;stamp=Date.now();}
        } else stable=null;
        await pause(170);
      }
      throw fault(409,'no_calls','原系统未列出此航次和中转港的靠次。');
    } catch(error) {
      if (error instanceof ReadError) throw error;
      if (await signedOut(page,cfg).catch(()=>false)) throw fault(401,'login_required','登录会话已过期，请重新登录。');
      if (attempt || page.isClosed()) throw fault(503,rejected || code,'Allegro 查询条件未就绪。');
      // No Search has been submitted. Reacquire the visible screen and reenter
      // BOTH requested fields if a native lookup re-renders one of the inputs.
      await pause(350);
    }
  }
}
async function checkForm(frame,C,vvd,port,time) {
  const [gotVvd,gotPort,selected,loading,local,ts]=await Promise.all([
    frame.locator(C.vvd).inputValue(),frame.locator(C.port).inputValue(),frame.locator(C.call+' option:checked').allTextContents(),frame.locator(C.loading).isChecked(),frame.locator(C.local).isChecked(),frame.locator(C.ts).isChecked()]);
  if (gotVvd!==vvd || gotPort!==port || selected.length!==1 || normalizeTime(selected[0])!==time || !loading || local || !ts) throw fault(409,'selection_changed','原系统的查询条件已改变。');
}

async function summaryRow(frame,label,kind) {
  // Grid columns may repeat these labels. Use the labeled native summary row, never a data row.
  const candidates=await frame.getByText(label,{exact:true}).filter({visible:true}).evaluateAll(nodes=>
    [...new Set(nodes.map(node=>node.closest('tr,[role="row"]')).filter(Boolean))].map(row=>row.innerText.replaceAll('\u00a0',' ')));
  const declared=candidates.filter(text=>kind==='ts' ? /\bLocal\s*:/i.test(text) && /\bT\s*\/\s*S\s*:/i.test(text) : /\b\d{2}\s*['′’]\s*:/.test(text));
  return declared.length===1 ? declared[0] : '';
}
async function exportCall(page,cfg,input,downloadTap,stage=()=>{}) {
  const opened=await openReport(page,cfg,stage);
  const C=cfg.controls, {vvd,port}=input;
  stage('criteria');
  const {frame,labels}=await prepareCriteria(page,cfg,opened,vvd,port,stage);
  stage('call');
  const pick=chooseCall(labels,input.expectedCall,input.allowSole===true,input.allowNearest===true);
  if (pick.kind==='choose') return pick;
  const {call,index}=pick;
  const provenance=pick.resolvedSole ? {resolvedSole:true} :
    pick.resolvedNearest ? {resolvedNearest:true,nativeCalls:pick.nativeCalls} : {};
  const attestedCalls=pick.resolvedNearest ? pick.nativeCalls : (pick.resolvedSole ? [call] : null);
  async function verifySelection() {
    await checkForm(frame,C,vvd,port,call);
    if (attestedCalls) {
      const active=completeCalls(await callLabels(frame,C.call));
      if (active?.length!==attestedCalls.length || active.some(({call},i)=>call!==attestedCalls[i])) {
        throw fault(409,'selection_changed','原系统的可选靠次已改变。');
      }
    }
  }
  await frame.locator(C.call).selectOption({index});
  await frame.locator(C.local).uncheck();await frame.locator(C.ts).check();
  await verifySelection();
  const readText=()=>Promise.all([summaryRow(frame,cfg.headers.ts,'ts'),summaryRow(frame,cfg.headers.size,'size')]);
  const before=await readText();
  const prior=JSON.stringify(before), startedAtZero=explicitZeroTotals(...before);
  let emptyAlert=false, settled=false, sourceFailed=false;
  const pending=new Set();
  const onStart=req=>{if (['xhr','fetch'].includes(req.resourceType())&&req.frame()===frame&&isPermittedUrl(req.url(),cfg.origin)) {pending.add(req);settled=false;}};
  const onFinish=async req=>{
    if (!pending.has(req)) return;
    const res=await req.response().catch(()=>null);
    pending.delete(req);
    if (!res?.ok()) sourceFailed=true;
    if (res?.ok() && !pending.size) settled=true;
  };
  const onFailure=req=>{if (pending.delete(req)) sourceFailed=true;};
  const onDialog=async dlg=>{
    if (downloadTap.receive) {
      if (dlg.type()==='confirm' && isExportConfirmation(dlg.message())) {
        downloadTap.trace('export_confirm');
        await dlg.accept().catch(()=>{});
        return;
      }
      downloadTap.trace('export_dialog_blocked');
    } else if (messageNoData.test(dlg.message().trim()) ||
        dlg.type()==='alert' && /^There is no list\.$/i.test(dlg.message().trim())) emptyAlert=true;
    await dlg.dismiss().catch(()=>{});
  };
  const visibleEmpty=()=>frame.getByText(messageNoData).filter({visible:true}).count();
  const initialEmpty=await visibleEmpty();
  page.on('request',onStart);page.on('requestfinished',onFinish);page.on('requestfailed',onFailure);page.context().on('dialog',onDialog);
  try {
    stage('search');
    await frame.locator(C.search).click();
    stage('totals');
    const end=Date.now()+90000;let sums, zeroSince=0;
    const cargoRows=frame.getByRole('row',{name:new RegExp('^\\s*\\d+\\s+.*\\b'+vvd+'\\b','i')});
    while (Date.now()<end) {
      const texts=await readText();
      const changed=JSON.stringify(texts)!==prior;
      if (changed || settled || emptyAlert) {
        const counts=readCounts(...texts);
        if (counts?.boxes>0 && await cargoRows.count()) {sums=counts;break;}
        const freshZero=changed && !startedAtZero && settled && !sourceFailed && !pending.size && explicitZeroTotals(...texts);
        if (freshZero && !await hasContainerRows(frame,cargoRows)) {
          if (zeroSince && Date.now()-zeroSince>=350) {sums={boxes:0,teu:0};break;}
          zeroSince ||= Date.now();
        } else zeroSince=0;
        if ((!counts || counts.boxes===0) && (emptyAlert || await visibleEmpty() && (!initialEmpty || settled)) &&
            !await hasContainerRows(frame,cargoRows)) {sums={boxes:0,teu:0};break;}
      }
      await pause(250);
    }
    if (!sums) throw fault(504,'totals_unconfirmed','未能核对原系统查询后的箱量。');
    await verifySelection();
    if (!sums.boxes) return {kind:'empty',...sums,call,...provenance};
    stage('download');
    let bytes;
    try {
      bytes=await downloadWorkbook(page,frame,cfg,downloadTap,stage);
    } catch {
      // Use the same selected, displayed report. The fallback independently
      // checks container numbers, count, TEU and source gross weight.
      stage('grid_read');
      await verifySelection();
      try {
        bytes=await workbookFromVisibleGrid(frame,{vvd,port,boxes:sums.boxes,teu:sums.teu,timeoutMs:24000});
        if (!isXlsx(bytes)) throw new Error('workbook');
      } catch {
        throw fault(422,'grid_unconfirmed','原生 Excel 下载失败，页面明细也未能与原系统合计逐项核对。');
      }
    }
    await verifySelection();
    stage('file');
    return {kind:'file',call,bytes,...sums,...provenance};
  } finally {page.off('request',onStart);page.off('requestfinished',onFinish);page.off('requestfailed',onFailure);page.context().off('dialog',onDialog);}
}

function isExportConfirmation(message) {
  const text=message.trim().replace(/\s+/g,' ');
  return /^(?:(?:are you sure (?:that )?you (?:want|wish) to|(?:do|would) you (?:want|like) to|please confirm(?: you (?:want|wish) to)?) )?(?:export|download)(?: (?:this|the|an?))?(?: (?:list|data|report|file|results))?(?: (?:as|in|to)(?: an?)?)? (?:excel|xlsx)(?: (?:format|file|workbook))?[?.!]?$/i.test(text);
}

async function readDownload(download,frame,cfg,tap) {
  try {
    // A successful browser transfer has a local artifact even if its filename
    // is localized or the URL carries no extension. Validate the workbook bytes.
    if (!await download.failure()) {
      const file=await download.path();
      if (file) {
        const size=(await stat(file)).size;
        if (size>maximumFile) throw fault(413,'workbook_size','原生清单大小超出限制。');
        if (size>0) {
          const bytes=await readFile(file);
          if (isXlsx(bytes)) return bytes;
        }
      }
    }
    const url=download.url();
    tap.trace('export_event_recovery');
    // Some report grids offer an exact data: URL through a native download.
    if (url.startsWith('data:') && url.length<Math.ceil(maximumFile/3)*4+200) {
      const comma=url.indexOf(',');
      if (comma>0 && comma<180 && /;base64$/i.test(url.slice(0,comma))) {
        const bytes=Buffer.from(url.slice(comma+1),'base64');
        if (bytes.length<=maximumFile && isXlsx(bytes)) return bytes;
      }
    }
    if (url.startsWith('blob:'+cfg.origin+'/')) {
      const frames=[...new Set([frame,...download.page().frames()])];
      for (const owner of frames) {
        if (!isPermittedUrl(owner.url(),cfg.origin)) continue;
        const encoded=await owner.evaluate(async ([url,limit])=>{
          const blob=await (await fetch(url)).blob();
          if (!blob.size || blob.size>limit) return '';
          return new Promise(resolve=>{
            const reader=new FileReader();
            reader.onerror=()=>resolve('');
            reader.onload=()=>resolve(String(reader.result).split(',',2)[1]||'');
            reader.readAsDataURL(blob);
          });
        },[url,maximumFile]).catch(()=>'');
        const bytes=Buffer.from(encoded,'base64');
        if (isXlsx(bytes)) {tap.trace('export_blob');return bytes;}
      }
    } else if (isPermittedUrl(url,cfg.origin) && tap.getUrls?.has(url)) {
      // Never turn a POST export into a second GET or re-submit a native form.
      return await tap.fetchAttachment(url,frame.url());
    }
  } finally {await download.delete().catch(()=>{});}
  throw fault(502,'download_failed','未能取得原生 Excel 清单。');
}

async function downloadWorkbook(page,frame,cfg,tap,stage) {
  const ctx=page.context(),armed=new Set(),traced=new Set();
  let timer;
  const bytesReady=new Promise(resolve=>{tap.receive=resolve;});
  tap.trace=label=>{if(!traced.has(label)){traced.add(label);stage(label);}};
  tap.getUrls=new Set();
  const button=frame.locator(cfg.controls.export);
  // Chromium can bypass page routing when a native download link is handed
  // straight to the download manager. Its own href identifies a safe GET retry.
  const href=await button.evaluate(node=>node.closest('a[download][href]')?.href||'').catch(()=>'');
  if (isPermittedUrl(href,cfg.origin)) tap.getUrls.add(href);
  const onDownload=download=>{
    tap.trace('export_event');
    readDownload(download,frame,cfg,tap).then(bytes=>tap.receive?.(bytes)).catch(()=>{});
  };
  const arm=owner=>{if(!armed.has(owner)){armed.add(owner);owner.on('download',onDownload);}};
  const onPage=owner=>{tap.trace('export_popup');arm(owner);};
  ctx.on('page',onPage);
  for (const owner of ctx.pages()) arm(owner);
  try {
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(fault(504,'download_failed','未能取得原生 Excel 清单。')),78000);});
    const [bytes]=await Promise.all([Promise.race([bytesReady,timeout]),button.click({noWaitAfter:true})]);
    return bytes;
  } finally {
    clearTimeout(timer);tap.receive=null;tap.getUrls=null;
    // Outstanding browser download events can finish after the first valid byte stream.
    tap.trace=()=>{};
    ctx.off('page',onPage);
    for(const owner of armed) owner.off('download',onDownload);
  }
}

export function isXlsx(data) {
  return Buffer.isBuffer(data) && data.subarray(0,4).equals(zipMagic) && data.includes(Buffer.from('xl/workbook.xml')) &&
    data.includes(Buffer.from('[Content_Types].xml')) && data.includes(Buffer.from('xl/worksheets/')) && data.lastIndexOf(Buffer.from([0x50,0x4b,5,6]))>=0;
}

export async function useBrowser(cfg,jar,execute,loginOnly=null) {
  if (createHash('sha256').update(String(cfg.origin)).digest('hex')!==originPin) throw fault(400,'reader_config','配置无效。');
  let submitted=false;
  const [{chromium}, {default:binary}]=await Promise.all([import('playwright-core'),import('@sparticuz/chromium')]);
  binary.setGraphicsMode=false;
  const executablePath=await binary.executablePath();
  const agent=new https.Agent({keepAlive:true,maxSockets:16,ca:verifiedCA(),rejectUnauthorized:true});
  let browser,ctx,timer;
  try {
    browser=await chromium.launch({executablePath,args:binary.args.filter(arg=>!['--ignore-certificate-errors','--disable-web-security','--allow-running-insecure-content','--disable-site-isolation-trials'].includes(arg) && !arg.startsWith('--disable-features=')),headless:true,timeout:35000});
    ctx=await browser.newContext({acceptDownloads:true,locale:'en-US',serviceWorkers:'block',viewport:{width:1440,height:960}});
    await ctx.addCookies(jar);
    const downloadTap={receive:null,fetchAttachment:async (source,referer)=>{
      // Chromium can hand attachment navigation directly to its download manager.
      // Retry only the exact file URL emitted by this user-initiated native download.
      let url=source;
      for(let i=0;i<4;i++) {
        if(!isPermittedUrl(url,cfg.origin)) break;
        const cookies=await ctx.cookies(url);
        const headers={accept:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream',referer,
          cookie:cookies.map(c=>c.name+'='+c.value).join('; ')};
        const response=await requestPage(agent,{url:()=>url,method:()=>'GET',allHeaders:async()=>headers,postDataBuffer:()=>null},cfg.origin);
        if(response.cookies.length) await applySourceCookies(ctx,response.cookies,url);
        if(response.status>=200 && response.status<300 && isXlsx(response.body)) return response.body;
        if(![301,302,303,307,308].includes(response.status)||!response.headers.location) break;
        url=new URL(response.headers.location,url).href;
      }
      throw fault(502,'download_failed','未能取得原生清单。');
    }};
    await ctx.route('**/*',async route=>{
      const req=route.request();
      if (!isPermittedUrl(req.url(),cfg.origin) || ['image','media','font'].includes(req.resourceType())) return route.abort().catch(()=>{});
      if (loginOnly && req.method()==='POST') {
        if(submitted || !loginOnly.armed || req.url()!==loginOnly.submitUrl) {
          if(submitted && req.url()!==loginOnly.submitUrl) loginOnly.followup=true;
          return route.abort().catch(()=>{});
        }
        submitted=true;
      }
      try {
        // Native report generators can POST the complete selected grid, including
        // thousands of cells, to create a file. Keep the normal limit for all other operations.
        const exportActive=!!downloadTap.receive && !loginOnly;
        if(exportActive && req.method()==='POST') {
          downloadTap.getUrls.delete(req.url());
          downloadTap.trace('export_post');
          if ((req.postDataBuffer()?.length||0)>256*1024) downloadTap.trace('export_post_large');
        } else if(exportActive && req.method()==='GET' && downloadTap.getUrls.size<128) {
          downloadTap.getUrls.add(req.url());
        }
        const res=await requestPage(agent,req,cfg.origin,exportActive && req.method()==='POST' ? maximumFile : undefined);
        if(loginOnly && req.method()==='POST' && [307,308].includes(res.status)) return route.abort().catch(()=>{});
        if (res.cookies.length) await applySourceCookies(ctx,res.cookies,req.url());
        if (exportActive && downloadTap.receive && res.status>=200 && res.status<300 && isXlsx(res.body)) {
          downloadTap.trace('export_response');
          downloadTap.receive(res.body);
        }
        await route.fulfill({status:res.status,headers:res.headers,body:res.body});
      } catch {await route.abort().catch(()=>{});}
    });
    await ctx.routeWebSocket(/.*/, ws=>ws.close());
    const page=await ctx.newPage();page.setDefaultTimeout(12000);
    return await Promise.race([execute(page,downloadTap),new Promise((_,reject)=>{timer=setTimeout(()=>reject(fault(504,'query_timeout','原系统查询超时，请重试。')),loginOnly ? 154000 : 204000);})]);
  } catch (error) {
    if (error instanceof ReadError || loginOnly && loginOnly.recognizes(error)) throw error;
    throw fault(502,'native_query_failed','未能核对原生装船清单。');
  } finally {
    clearTimeout(timer);agent.destroy();
    if (ctx) await ctx.close().catch(()=>{});
    if (browser) await browser.close().catch(()=>{});
  }
}


export async function readManifest(input, rawConfig,stage=()=>{}) {
  const cfg=validateConfig(rawConfig);
  if (!/^[A-Z0-9]{4,16}$/.test(input?.vvd) || !/^[A-Z]{2}[A-Z0-9]{3}$/.test(input.port)) throw fault(400,'bad_selection','航次或港口格式无效。');
  const jar=suppliedCookies(input.cookies,new URL(cfg.origin).hostname);
  stage('browser');
  return useBrowser(cfg,jar,(page,tap)=>exportCall(page,cfg,input,tap,stage));
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
