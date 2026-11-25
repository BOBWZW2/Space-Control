import https from 'node:https';
import {createHash} from 'node:crypto';
import {verifiedCA} from './login-ca.mjs';
import {Invalid} from './protocol.mjs';

const fields=['origin','form','submit','check','uid','pwd','button','envelope','userField','passField','successKey','successValue','statusKey'];
const targetPin='7a2a69d8a92f6d3451d71e040065dd041a03486bb51783e4f0eb1c4f37ebbc2e';
function target(c) {
  if(!c || typeof c!=='object' || fields.some(k=>typeof c[k]!=='string') ||
    createHash('sha256').update(JSON.stringify(fields.map(k=>c[k]))).digest('hex')!==targetPin) throw new Invalid(400,'invalid');
  return Object.fromEntries(fields.map(k=>[k,c[k]]));
}
function nativeRequest(url,options,body) {
  return new Promise((resolve,reject)=>{
    const req=https.request(url,options,async res=>{
      try {
        const chunks=[];let length=0;
        for await(const chunk of res) {
          length+=chunk.length;
          if(length>512*1024) {res.destroy();throw new Error();}
          chunks.push(chunk);
        }
        resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(chunks).toString('utf8')});
      } catch{reject(new Invalid(502,'allegro_unavailable'));}
    });
    req.once('error',()=>reject(new Invalid(502,'allegro_unavailable')));
    req.end(body);
  });
}
function capture(jar,values) {
  for(const cookie of (typeof values==='string'?[values]:values||[])) {
    const pair=cookie.split(';',1)[0], index=pair.indexOf('=');
    if(index<1) continue;
    const k=pair.slice(0,index).trim(),v=pair.slice(index+1).trim();
    if(!/^[\w.-]{1,80}$/.test(k)||['constructor','prototype','__proto__'].includes(k)||v.length>4096||/[^\x21-\x7e]|[;,]/.test(v)) continue;
    if(!v || /;\s*max-age\s*=\s*(?:0|-\d+)\b/i.test(cookie)) delete jar[k]; else jar[k]=v;
  }
  if(Object.keys(jar).length>80 || Buffer.byteLength(JSON.stringify(jar))>6000)throw new Invalid(502,'invalid_session');
}
function knownForm(html,c) {
  const tags=html.match(/<(?:input|button)\b[^>]*>/gi)||[];
  const controls=tags.map(tag=>new Map([...tag.matchAll(/\s([a-z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s/>]+))/gi)]
    .map(m=>[m[1].toLowerCase(),m[2]??m[3]??m[4]])));
  if(!controls.some(a=>a.get('id')===c.pwd))return false;
  return html.includes(c.submit.slice(c.submit.lastIndexOf('/'))) ||
    (controls.some(a=>a.get('id')===c.pwd && a.get('type')?.toLowerCase()==='password') &&
      controls.some(a=>a.get('id')===c.uid) && controls.some(a=>a.get('id')===c.button));
}
function objectJSON(text) {
  try {
    const object=JSON.parse(text);
    if(!object || Array.isArray(object) || typeof object!=='object')throw Error();
    return object;
  } catch{throw new Invalid(502,'unexpected_response');}
}

export async function portalLogin(payload,send=nativeRequest) {
  const c=target(payload.cfg);
  const {username,password}=payload;
  if(typeof username!=='string' || !username.trim() || username.length>100 || typeof password!=='string' || !password || password.length>256) throw new Invalid(400,'invalid');
  const jar=Object.create(null);
  const agent=new https.Agent({ca:verifiedCA(),rejectUnauthorized:true,keepAlive:true,maxSockets:1});
  const deadline=AbortSignal.timeout(22500);
  async function request(path,method='GET',body) {
    const url=new URL(path,c.origin);
    const readHeaders={'accept-encoding':'identity','accept-language':'en-US,en;q=0.8',origin:c.origin,referer:new URL(c.form,c.origin).href,'cache-control':'no-cache'};
    readHeaders.accept=path===c.form ? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' : 'application/json, text/javascript, */*; q=0.01';
    if(path!==c.form) readHeaders['x-requested-with']='XMLHttpRequest';
    if(body) readHeaders['content-type']='application/json; charset=UTF-8';
    readHeaders.cookie=Object.entries(jar).map(([k,v])=>k+'='+v).join('; ');
    const response=await send(url,{method,headers:readHeaders,agent,signal:deadline},body);
    // Each stage has one pinned URL; never resend a credential-bearing request to a redirect.
    if(response.status<200 || response.status>=300) {
      if(path===c.submit && response.status===401)throw new Invalid(401,'invalid_credentials');
      throw new Invalid(502,'allegro_unavailable');
    }
    capture(jar,response.headers['set-cookie']);
    return response.text;
  }
  try{
    if(!knownForm(await request(c.form),c))throw new Invalid(502,'unexpected_login_page');
    const data=objectJSON(await request(c.submit,'POST',JSON.stringify({header:{},[c.envelope]:{[c.userField]:username.trim(),[c.passField]:password}})));
    const signon=data[c.envelope] || data.user || data;
    if(typeof signon[c.successKey]!=='string')throw new Invalid(502,'unexpected_response');
    if(signon[c.successKey]!==c.successValue)throw new Invalid(401,'invalid_credentials');
    const check=objectJSON(await request(c.check));
    if(check[c.statusKey]!==true || !Object.keys(jar).length)throw new Invalid(502,'invalid_session');
    return jar;
  }finally{agent.destroy();}
}
