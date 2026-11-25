// Only fixed categories escape this module. Native messages and response bodies are never returned.
const rules=[
  ['login_session_conflict',/(?:already|currently)\s+(?:been\s+)?(?:logged|signed)\s*(?:in|on)|another\s+(?:active\s+)?(?:session|device).{0,40}(?:log|sign|disconnect)|(?:duplicate|concurrent|simultaneous)\s+(?:login|logon|sign.?in|session)|(?:已在|另一个|其他).{0,12}(?:设备|会话|地点).{0,12}(?:已|登录)|동시\s*접속/i],
  ['login_password_expired',/(?:password|passcode).{0,28}(?:expired|must be changed)|(?:change|reset)\s+(?:your\s+)?password\s+(?:before|now|to continue)|密码.{0,8}(?:到期|过期)|비밀번호.{0,12}만료/i],
  ['login_account_locked',/(?:account|user\s*id).{0,30}(?:is |has been )?(?:locked|disabled|suspended|inactive)|账号.{0,8}(?:被锁|锁定|停用)|계정.{0,10}잠/i],
  ['login_interactive_needed',/(?:enter|provide|verify|verification|authentication|请输入|校验).{0,22}(?:one.time|security code|authenticator|验证码)|(?:multi.?factor|two.?factor|captcha|human verification|2FA\b)|\bMFA\s+(?:required|challenge)|\bSSO (?:login |sign.in )?(?:required|only)|多因素|双因素/i],
  ['login_access_denied',/(?:access|request) (?:has been |is )?(?:denied|forbidden|blocked|rejected)|not (?:authorized|permitted|allowed) (?:to|from)|(?:IP(?: address)?|network|region|country).{0,22}(?:restricted|denied|not allowed|blocked)|permission denied|you have been blocked|拒绝访问|禁止访问|无权(?:访问|登录)/i],
  ['invalid_credentials',/(?:invalid|incorrect|unknown|wrong) (?:user\s*(?:name|id)|password|credentials|login ID)|(?:password|credentials|user\s*id) (?:is |are )?(?:incorrect|invalid|wrong|not found)|(?:account|user\s*(?:name|id)) (?:does not exist|not found)|(?:用户名|账号|密码).{0,12}(?:不正确|错误|不存在)|비밀번호.{0,8}(?:불일치|일치하지)/i]
];
export function nativeMessage(text){
  if(typeof text!=='string') return null;
  const source=text.slice(0,1200);
  for(const [reason,match] of rules)if(match.test(source))return reason;
  return null;
}
const messageKeys=['message','messages','messageText','messageDescription','messageCode','msg','msgText','reason','errorMessage','error_description','description','faultstring'];
const nestedKeys=['signon','signOn','user','data','body','result','response','header','error','errors','detail','responseData','return','fault','envelope','dataset'];
function inspectJson(root,input){
  if(typeof root==='string'){try{root=JSON.parse(root);}catch{return {kind:'reply_other_json'};}}
  const queue=[root],seen=new Set(),messageObjects=new Set([root]);
  let result,accepted=false,headerFailure=false,reason=null;
  const detail={};
  while(queue.length&&seen.size<40){
    const n=queue.shift();
    if(!n||typeof n!=='object'||seen.has(n))continue;
    seen.add(n);
    if(Array.isArray(n)){queue.push(...n.slice(0,4));continue;}
    const hasStatus=['returnCode','errorMessageProcessed','signOnResult','signonResult','signInResult'].some(k=>Object.hasOwn(n,k));
    const src=hasStatus||messageObjects.has(n)?privateDetail(n,input):{};
    if(src.sourceMessage&&!detail.sourceMessage)detail.sourceMessage=src.sourceMessage;
    if(src.sourceReference&&!detail.sourceReference)detail.sourceReference=src.sourceReference;
    for(const key of ['signOnResult','signonResult','signInResult']){
      if(typeof n[key]==='string'){
        result=n[key].trim().toLowerCase();
        accepted=accepted || result==='success';
        reason??=nativeMessage(n[key]);
      }
    }
    if((n.errorMessageProcessed===true || /^(?:true|y|1)$/i.test(String(n.errorMessageProcessed))) || n.returnCode!=null && String(n.returnCode)!=='0' && String(n.returnCode)!=='') headerFailure=true;
    for(const key of messageKeys) {
      const val=n[key]; reason??=nativeMessage(val);
      if(Array.isArray(val))for(const t of val.slice(0,4))reason??=nativeMessage(t);
    }
    for(const key of nestedKeys) {
      const val=n[key];
      if(typeof val==='string')reason??=nativeMessage(val);
      else if(val&&typeof val==='object'){
        if(['header','error','signon','signOn','fault'].includes(key))messageObjects.add(val);
        queue.push(val);
      }
    }
  }
  if(accepted)return {kind:'reply_success',reason,...detail};
  if(result!=null)return {kind:'reply_rejected',reason,...detail};
  return {kind:headerFailure?'reply_business_error':'reply_other_json',reason,...detail};
}
export function nativeReply(bytes,input){
  if(!bytes?.length)return {kind:'reply_empty'};
  if(bytes.length>262144)return {kind:'reply_unreadable'};
  const text=bytes.toString('utf8').trim().replace(/^\uFEFF/,'').trim();
  if(!text)return {kind:'reply_empty'};
  try{return inspectJson(JSON.parse(text),input);}catch{}
  if(/^(?:<!doctype\s+html|<html\b)/i.test(text) || /<html\s|<title>/i.test(text)) {
    const title=(text.match(/<title\b[^>]*>([^<]*)<\/title>/i)||[])[1];
    const head=(text.match(/<h1\b[^>]*>([^<]*)<\/h1>/i)||[])[1];
    return {kind:/<input\b[^>]*(?:type\s*=\s*["']?password|id\s*=\s*["']userPw)/i.test(text)?'reply_login_html':'reply_html',
      reason:nativeMessage(title)||nativeMessage(head)};
  }
  if(/^<[?\w]/.test(text)){
    const elements={};for(const key of ['signOnResult','message','returnCode','errorMessageProcessed','faultstring']){
      const hit=text.match(new RegExp('<(?:[A-Za-z0-9_]+:)?'+key+'(?:\\s[^>]*|)>([^<]{0,300})<','i'));
      if(hit)elements[key]=hit[1];
    }
    const meta=inspectJson(elements,input);
    return meta.kind==='reply_other_json'?{kind:'reply_xml',reason:meta.reason}:meta;
  }
  return {kind:'reply_text',reason:nativeMessage(text)};
}

// Vendor text may embed submitted fields, IDs or internal data. Only conventional,
// ordinary end-user sentence vocabulary or fixed support references can be returned.
const allowedWords=new Set(("a an the your this that another already currently previous active account user id name username password credentials log login logon sign in on out " +
  "access authentication authorization verification security session connection service request operation system information data record records status details required " +
  "is are was were be been being has have had can cannot could may maynot must should please do does did not unable allowed available unavailable valid invalid incorrect wrong " +
  "unknown expired locked blocked denied failed failure processed completed supported permitted authorized authenticated verified established allowed enabled disabled suspended " +
  "inactive restricted missing configured specified provided entered submitted duplicate concurrent multiple existing used signed logged found exist match matched recognized correct " +
  "login retry try again later first now before after from to of for by with without at into or and only temporarily successfully too many attempts exceeded limit " +
  "wait contact administrator support help desk office company current network address location country reason change reset select complete provide additional " +
  "information factor two multi code confirm confirmation continue open close other device browser verification valid date time temporarily occurred during " +
  "server error unexpected internal temporary processing database communication response received no there customer has been unable proper successfully process " +
  "an error occurred checking permissions policy violation verify identifier credential no matching invalid mismatched format please check enter exists " +
  "requesting mandatory expired registered available registration organization cannot allow online account access failed to find retry saving language " +
  "you need still using through authorized insufficient rights permission stopped disconnected established signing logging retrying unable proceed allowed " +
  "match properly requested transaction processed unsuccessful successfully could not complete actions required concurrent session detected").split(/\s+/));
const knownCjk=new Set(['用户名或密码错误','用户名或密码不正确','账号或密码错误','账号已被锁定','账号已锁定','密码已过期','请修改密码','拒绝访问','无权登录','无权访问','请联系管理员','系统错误，请联系管理员','系统暂时无法处理您的请求','请求无效','用户不存在','该用户已登录','当前账号已在其他设备登录','비밀번호가 일치하지 않습니다','사용자 정보가 없습니다','로그인 정보가 올바르지 않습니다','접근 권한이 없습니다','관리자에게 문의하세요','인증에 실패했습니다'].map(t=>t.normalize('NFKC')));
const plainDetail=(value)=>typeof value==='string' ? value.normalize('NFKC').trim() : '';
const normalizedField=s=>s.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
function overlapsField(value,input) {
  if(!input || typeof input.username!=='string' || !input.username || typeof input.password!=='string' || !input.password) return true;
  const s=value.toLowerCase(),n=normalizedField(s);
  return [input.username,input.password].some(field=>{
    const v=field.normalize('NFKC').trim().toLowerCase(),f=normalizedField(v);
    return !v || s.includes(v) || !!f && n.includes(f);
  });
}
export function safeHumanReason(value,input) {
  if(typeof value!=='string' || value.length>144 || /[\p{C}\u2028\u2029]/u.test(value)) return null;
  const s=plainDetail(value).replace(/ +/g,' ');
  if(!s || s.length>144 || overlapsField(s,input))return null;
  if(knownCjk.has(s.replace(/[。.!]$/,'')))return s;
  // Do not pass through arbitrary words (names, secret strings, paths) even in a sentence.
  if(s.length<5 || !/^[A-Za-z ,.!?'-]+$/.test(s) || /[\w][.][\w]|\.\.|--|\b(?:token|secret|sql|trace|stack|key|cookie|bearer|http|https|payload|exception)\b/i.test(s))return null;
  const parts=s.toLowerCase().match(/[a-z]+/g)||[];
  if(parts.length<3 || parts.length>24 || !parts.every(w=>allowedWords.has(w)))return null;
  if(!/^(?:the|a[n]? |your |this |you |user |account |password |invalid |incorrect |wrong |unknown |login |logon |log |sign |authentication |access |security |permission |request |please |no |there |unable |cannot |service |system |session |duplicate |another |verification |operation |additional |error |internal |failed |too many |contact |only )/i.test(s))return null;
  if(!/\b(?:invalid|incorrect|wrong|unknown|denied|failed|failure|error|not|unable|cannot|unavailable|expired|locked|suspended|inactive|required|must|contact|duplicate|already|invalid|retry|exceeded|blocked|restricted|disabled|no|insufficient|check|verify|confirm)\b/i.test(s))return null;
  return s;
}
export function safeVendorReference(value,input) {
  if(typeof value!=='string' || /[\p{C}]/u.test(value) || value.length>21)return null;
  const s=value.trim();
  return /^(?:AUTH|LOGIN|SEC|ERR)(?:[-_](?:ERR|ERROR))?[-_]\d{1,4}$/.test(s) && !overlapsField(s,input) ? s:null;
}
export function privateDetail(node,input) {
  if(!node||typeof node!=='object'||!input)return {};
  const info={};
  // Do not recursively collect arbitrary fields, or accept arbitrary message references.
  for(const k of ['message','messageText','errorMessage','msg','messageDescription','description','faultstring']){
    const m=safeHumanReason(node[k],input);if(m){info.sourceMessage=m;break;}
  }
  for(const k of ['messageCode','errorCode']){
    const ref=safeVendorReference(node[k],input);if(ref){info.sourceReference=ref;break;}
  }
  return info;
}
export function safeLoginDetail(value,input) {
  const out={};
  const message=safeHumanReason(value?.sourceMessage,input);
  const reference=safeVendorReference(value?.sourceReference,input);
  if(message)out.sourceMessage=message;
  if(reference)out.sourceReference=reference;
  return out;
}
