import {createHash} from 'node:crypto';
import {Invalid} from './protocol.mjs';
import {useBrowser} from './reader.mjs';

const fields=['origin','form','submit','check','uid','pwd','button','envelope','userField','passField','successKey','successValue','statusKey'];
const targetPin='7a2a69d8a92f6d3451d71e040065dd041a03486bb51783e4f0eb1c4f37ebbc2e';
function target(c) {
  if(!c || typeof c!=='object' || fields.some(k=>typeof c[k]!=='string') ||
    createHash('sha256').update(JSON.stringify(fields.map(k=>c[k]))).digest('hex')!==targetPin) throw new Invalid(400,'invalid');
  return Object.fromEntries(fields.map(k=>[k,c[k]]));
}

async function checkSession(page,c) {
  // Same HTTPS session and read-only session check used by the source application's signed-in shell.
  const status=await page.evaluate(async ([url,field])=>{
    const res=await fetch(url,{method:'GET',credentials:'same-origin',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000),
      headers:{'Accept':'application/json, text/plain, */*','X-Requested-With':'XMLHttpRequest'}});
    if(!res.ok) return 'http';
    const data=await res.json().catch(()=>null);
    return data && typeof data[field]==='boolean' ? data[field] : 'invalid';
  },[c.origin+c.check,c.statusKey]).catch(()=>{throw new Invalid(502,'login_check_transport');});
  if(status==='http') throw new Invalid(502,'login_check_http');
  if(typeof status!=='boolean') throw new Invalid(502,'unexpected_session_response');
  return status;
}

async function sessionCookies(context,checkURL) {
  const jar=Object.create(null);
  for(const {name,value} of await context.cookies(checkURL)) {
    if(!/^[\w.-]{1,80}$/.test(name) || ['constructor','__proto__','prototype'].includes(name) ||
        !value || value.length>4096 || /[^\x21-\x7e]|[;,]/.test(value)) continue;
    if(Object.hasOwn(jar,name) && jar[name]!==value) throw new Invalid(502,'invalid_session');
    jar[name]=value;
  }
  if(!Object.keys(jar).length || Object.keys(jar).length>80 || Buffer.byteLength(JSON.stringify(jar))>6000) throw new Invalid(502,'invalid_session');
  return jar;
}

export async function portalLogin(payload,reportStage=()=>{},run=useBrowser) {
  const c=target(payload.cfg);
  const probe=Object.hasOwn(payload,'probe');
  if(probe && (payload.probe!==true || Object.hasOwn(payload,'username') || Object.hasOwn(payload,'password'))) throw new Invalid(400,'invalid_probe');
  if(!probe && (typeof payload.username!=='string' || !payload.username.trim() || payload.username.length>100 ||
      typeof payload.password!=='string' || !payload.password || payload.password.length>256)) throw new Invalid(400,'invalid');
  const policy={submitUrl:c.origin+c.submit,armed:false,recognizes:e=>e instanceof Invalid};
  let phase='page';
  function setPhase(value){phase=value;reportStage(value);}
  try {
    setPhase('page');
    return await run(c,[],async page=>{
      const formResponse=await page.goto(c.origin+c.form,{waitUntil:'domcontentloaded',timeout:17000});
      if(!formResponse || !formResponse.ok() || new URL(page.url()).origin!==c.origin) throw new Invalid(502,'login_form_http');
      setPhase('form');
      const uid=page.locator('#'+c.uid),pwd=page.locator('input[type="password"]#'+c.pwd),button=page.locator('#'+c.button);
      try {await Promise.all([uid,pwd,button].map(n=>n.waitFor({state:'visible',timeout:5000})));} catch {throw new Invalid(502,'unexpected_login_page');}
      if(probe) {
        setPhase('session');
        if(await checkSession(page,c)) throw new Invalid(502,'probe_session_check');
        setPhase('receipt');return {kind:'login-ready',landing:true,sessionCheck:true};
      }
      await uid.fill(payload.username.trim());
      await pwd.fill(payload.password);
      setPhase('submit');
      const responsePromise=page.waitForResponse(res=>res.url()===policy.submitUrl && res.request().method()==='POST',{timeout:14000});
      policy.armed=true;
      let response;
      try {
        [response]=await Promise.all([responsePromise,button.click({timeout:7000,noWaitAfter:true})]);
      } catch {throw new Invalid(502,'login_submit_transport');}
      finally {policy.armed=false;}
      if(response.status()===401) throw new Invalid(401,'invalid_credentials');
      if(!response.ok()) throw new Invalid(502,'login_submit_http');
      const data=await response.json().catch(()=>null);
      const result=(data?.[c.envelope] || data?.user || data)?.[c.successKey];
      if(typeof result==='string' && result.trim().toLowerCase()!==c.successValue.toLowerCase()) throw new Invalid(401,'invalid_credentials');
      // The native page can navigate in its sign-on callback. A stable same-origin page
      // verifies the resulting session without repeating the form POST.
      setPhase('session');
      const checkPage=await page.context().newPage();
      try {
        const res=await checkPage.goto(c.origin+c.check,{waitUntil:'domcontentloaded',timeout:8500});
        if(!res?.ok()) throw new Invalid(502,'login_check_http');
        const data=await res.json().catch(()=>null);
        if(typeof data?.[c.statusKey]!=='boolean') throw new Invalid(502,'unexpected_session_response');
        if(!data[c.statusKey]) throw new Invalid(502,typeof result==='string'?'invalid_session':'unexpected_signon_response');
      } finally {await checkPage.close().catch(()=>{});}
      setPhase('receipt');
      return sessionCookies(page.context(),c.origin+c.check);
    },policy);
  } catch(e) {
    if(e instanceof Invalid) throw e;
    throw new Invalid(502,phase==='submit'?'login_submit_transport':phase==='session'?'login_check_transport':phase==='receipt'?'invalid_session':'login_form_transport');
  }
}
