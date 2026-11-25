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
function inspectJson(root){
  if(typeof root==='string'){try{root=JSON.parse(root);}catch{return {kind:'reply_other_json'};}}
  const queue=[root],seen=new Set();
  let result,accepted=false,headerFailure=false,reason=null;
  while(queue.length&&seen.size<40){
    const n=queue.shift();
    if(!n||typeof n!=='object'||seen.has(n))continue;
    seen.add(n);
    if(Array.isArray(n)){queue.push(...n.slice(0,4));continue;}
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
      else if(val&&typeof val==='object')queue.push(val);
    }
  }
  if(accepted)return {kind:'reply_success',reason};
  if(result!=null)return {kind:'reply_rejected',reason};
  return {kind:headerFailure?'reply_business_error':'reply_other_json',reason};
}
export function nativeReply(bytes){
  if(!bytes?.length)return {kind:'reply_empty'};
  if(bytes.length>262144)return {kind:'reply_unreadable'};
  const text=bytes.toString('utf8').trim().replace(/^\uFEFF/,'').trim();
  if(!text)return {kind:'reply_empty'};
  try{return inspectJson(JSON.parse(text));}catch{}
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
    const meta=inspectJson(elements);
    return meta.kind==='reply_other_json'?{kind:'reply_xml',reason:meta.reason}:meta;
  }
  return {kind:'reply_text',reason:nativeMessage(text)};
}
