import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
export const SCHEDULE_ORIGIN='https://allegro-schedules-bob.brave-cocoa-4698.chatgpt.site';
const MAIN='https://ops.culines.com/oceans/webfw/html/nawmain.html';
const TTL=30*60*1000;
const fail=(message,status=400)=>Object.assign(new Error(message),{safe:true,status});
export function validateTasks(input){
 if(!Array.isArray(input)||!input.length||input.length>30)throw fail('请设置 1–30 条查询');
 const seen=new Set();
 return input.map(t=>{
  if(!t||!/^[-a-f0-9]{36}$/.test(t.id)||seen.has(t.id)||!t.enabled||!/[A-Z0-9]/.test((t.lane||'')+(t.vessel||''))||!['lane','vessel'].every(k=>typeof t[k]==='string'&&/^[A-Z0-9]{0,8}$/.test(t[k])))throw fail('航线、船舶或查询编号无效');
  seen.add(t.id);
  if(typeof t.sheet!=='string'||!t.sheet.trim()||t.sheet.length>31||/[\[\]:*?/\\\x00-\x1f]/.test(t.sheet)||t.sheet.startsWith("'")||t.sheet.endsWith("'"))throw fail('Sheet 名称无效');
  if(!Array.isArray(t.dates)||t.dates.length!==2)throw fail('日期范围无效');
  const ds=t.dates.map(v=>{const d=new Date(v+'T00:00:00Z');if(typeof v!=='string'||!/^20\d\d-\d\d-\d\d$/.test(v)||!Number.isFinite(+d)||d.toISOString().slice(0,10)!==v)throw fail('日期范围无效');return +d});
  if(ds[0]>ds[1]||ds[1]-ds[0]>366*86400000)throw fail('Period 最多一年');
  return {id:t.id,lane:t.lane,vessel:t.vessel,sheet:t.sheet.trim(),dates:t.dates};
 });
}
export function convert(root,input){return new Promise((resolve,reject)=>{
 const child=spawn(process.env.SCHEDULE_PYTHON||path.join(root,'runtime','python','python.exe'),[path.join(root,'tdr-helper','schedule-convert.py')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 let output=[],size=0;const timer=setTimeout(()=>{child.kill();reject(fail('Excel 转换超时',504))},30000);
 child.stdout.on('data',c=>{size+=c.length;if(size>32*1024*1024){child.kill();reject(fail('结果过大，请缩小范围'))}else output.push(c)});
 child.stderr.resume();child.stdin.on('error',()=>{});
 child.on('error',()=>{clearTimeout(timer);reject(fail('小助手组件不完整，请重新安装',503))});
 child.on('close',code=>{clearTimeout(timer);try{const result=JSON.parse(Buffer.concat(output).toString('utf8'));if(code||result.error)reject(fail(result.error||'Excel 转换失败'));else resolve(result)}catch{reject(fail('Excel 转换失败'))}});
 child.stdin.end(JSON.stringify(input));
})}
export function createScheduleAgent({root,resolveBrowserExecutable,beforeLogin}){
 let browser,context,page,connected=false,reservation=false,busy=false,office='',expires=0,job=null,attempts=[];
 async function close(){connected=false;reservation=false;office='';job=null;const old=browser;browser=context=page=undefined;await old?.close().catch(()=>{})}
 const sweep=setInterval(()=>{if(reservation&&!busy&&Date.now()>expires)void close()},30000);sweep.unref();
 async function login(v){
  if(reservation)throw fail('本机已有船期连接，请先断开',409);
  if(typeof v.username!=='string'||!v.username.trim()||v.username.length>100||typeof v.password!=='string'||!v.password||v.password.length>256||typeof v.office!=='string'||!/^[A-Z0-9]{0,8}$/.test(v.office))throw fail('请核对账号、密码及 Office');
  attempts=attempts.filter(t=>Date.now()-t<300000);if(attempts.length>=5)throw fail('登录尝试较多，请五分钟后重试',429);attempts.push(Date.now());
  reservation=true;busy=true;
  try{
   await beforeLogin();
   browser=await chromium.launch({executablePath:await resolveBrowserExecutable(),headless:true});
   context=await browser.newContext({acceptDownloads:true,locale:'en-US',viewport:{width:1440,height:1000}});
   await context.route('**/*',route=>{const u=new URL(route.request().url());return u.protocol==='https:'&&u.hostname==='ops.culines.com'?route.continue():route.abort()});
   page=await context.newPage();page.setDefaultTimeout(20000);page.on('dialog',d=>void d.dismiss());
   await page.goto('https://ops.culines.com/oceans/nawlogon.do',{waitUntil:'domcontentloaded',timeout:45000});
   await page.locator('#userId').fill(v.username);await page.locator('#userPw').fill(v.password);await page.locator('#btnLogin').click();
   await page.waitForURL(/\/oceans\/webfw\/html\/nawmain\.html/,{timeout:45000});await page.getByRole('button',{name:'Menu',exact:true}).waitFor();
   const select=page.getByRole('combobox').first();if(v.office)await select.selectOption({label:v.office});office=await select.inputValue();connected=true;expires=Date.now()+TTL;
   return {office,connected:true};
  }catch(e){await close();throw fail(e.code==='BROWSER_NOT_FOUND'?'请先安装 Microsoft Edge 或 Google Chrome':'Allegro 登录未完成，请检查网络、账号密码和 Office；原站如有验证码需先处理',401)}finally{busy=false}
 }
 async function openSchedule(){
  await page.goto(MAIN,{waitUntil:'domcontentloaded',timeout:45000});await page.getByRole('button',{name:'Menu',exact:true}).click();
  await page.getByText('Marine',{exact:true}).click();await page.getByText('Vessel Schedule',{exact:true}).nth(0).click();await page.getByText('Vessel Schedule',{exact:true}).nth(1).click();await page.getByText('Search',{exact:true}).click();await page.getByText('Search Long Range Schedule',{exact:true}).click();
  for(let i=0;i<40;i++){for(const f of page.frames()){if(f!==page.mainFrame()&&await f.getByRole('heading',{name:'Search Long Range Schedule',exact:true}).count())return f}await new Promise(r=>setTimeout(r,250))}throw fail('查询页面未加载');
 }
 async function setDate(f,field,value){const [y,m,d]=value.split('-').map(Number);await f.locator('#img_'+field).click();await f.locator('#calyear').selectOption(String(y));await f.locator('#calmonth').selectOption(String(m-1));await f.locator(`a[href="#${d}"]:not(.caloff)`).click();if(await f.locator('#'+field).inputValue()!==value)throw fail('日期设置失败')}
 async function query(t,state){
  const f=await openSchedule();await f.locator('#vslSvceLaneCd').fill(t.lane);await f.locator('#vslCd').fill(t.vessel);await f.locator('#radioPeriod2').check();await setDate(f,'fmDt',t.dates[0]);await setDate(f,'toDt',t.dates[1]);await f.getByRole('button',{name:'Search',exact:true}).click();
  let found=false;for(let i=0;i<120;i++){const text=await f.locator('body').innerText();if(text.includes('Result :')){found=true;break}if(/no data|no records|not found/i.test(text))return {blocks:[],notes:[]};await new Promise(r=>setTimeout(r,500))}if(!found)throw fail('未收到明确查询结果，请重试');
  state.state='downloading';const pending=page.waitForEvent('download',{timeout:60000});await f.getByRole('button',{name:'Export Excel',exact:true}).click();const download=await pending;
  try{if(await download.failure())throw fail('原始文件下载失败');const stream=await download.createReadStream();if(!stream)throw fail('下载为空');let chunks=[],size=0;for await(const c of stream){size+=c.length;if(size>8*1024*1024){stream.destroy();throw fail('原始文件超过 8MB')}chunks.push(c)}return await convert(root,{operation:'parse',data:Buffer.concat(chunks).toString('base64'),task:t})}finally{await download.delete()}
 }
 async function run(tasks,current){
  try{for(let i=0;i<tasks.length;i++){
   const state=current.tasks[i];state.state='querying';let timer;
   try{const result=await Promise.race([query(tasks[i],state),new Promise((_,reject)=>{timer=setTimeout(()=>{void page?.close().catch(()=>{});reject(fail('本条查询超时，请重新登录后重试'))},240000)})]);
    if(current.blocks.concat(result.blocks).reduce((n,b)=>n+b.rows.length,0)>10000)throw fail('结果超过一万行，请缩小范围');
    current.blocks.push(...result.blocks);current.notes.push(...result.notes.map(r=>[state.label,...r]));state.state=result.blocks.length?'complete':'empty';
   }catch(e){state.state='failed';state.message=e.safe?e.message:'查询或下载未完成，请重试'}finally{clearTimeout(timer)}current.progress=(i+1)/tasks.length*100;
   if(page?.isClosed()){for(const rest of current.tasks.slice(i+1)){rest.state='failed';rest.message='连接已中断，请重新登录'}connected=false;current.progress=100;break}
  }const failed=current.tasks.some(t=>t.state==='failed');current.state=failed?(current.blocks.length?'partial':'failed'):'complete';}finally{busy=false;expires=Date.now()+TTL}
 }
 const publicJob=()=>({...job,notes:undefined,blocks:job.state==='running'?[]:job.blocks.map(b=>Object.fromEntries(Object.entries(b).filter(([k])=>!k.startsWith('_'))))});
 async function handle(req,res,url){
  const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value))};
  if(req.headers.host!=='127.0.0.1:4318'||req.headers.origin!==SCHEDULE_ORIGIN)return json(403,{error:'来源不受信任'});
  res.setHeader('Access-Control-Allow-Origin',SCHEDULE_ORIGIN);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, X-Allegro-Client');res.setHeader('Access-Control-Allow-Private-Network','true');res.setHeader('Access-Control-Expose-Headers','Content-Disposition');
  if(req.method==='OPTIONS'){res.writeHead(204);return res.end()}
  if(req.headers['x-allegro-client']!=='schedule-v1')return json(403,{error:'客户端标识无效'});
  try{
   if(req.method==='GET'&&url.pathname==='/api/schedule/status'){if(reservation&&!busy&&Date.now()>expires)await close();let ready=true;try{await resolveBrowserExecutable()}catch{ready=false}return json(200,{configured:true,ready,connected,office,version:'1.1.0',jobId:job?.id})}
   let body={};if(req.method==='POST'){if(!req.headers['content-type']?.startsWith('application/json'))throw fail('请求格式无效',415);let bytes=0,chunks=[];for await(const c of req){bytes+=c.length;if(bytes>131072)throw fail('请求过大',413);chunks.push(c)}try{body=JSON.parse(Buffer.concat(chunks).toString())}catch{throw fail('请求格式无效')}}
   if(req.method==='POST'&&url.pathname==='/api/schedule/login')return json(200,await login(body));
   if(req.method==='POST'&&url.pathname==='/api/schedule/logout'){if(busy)throw fail('操作执行中，请完成后断开',409);await close();return json(200,{ok:true})}
   if(!reservation||(!busy&&Date.now()>expires))throw fail('会话已过期，请重新登录',401);
   if(req.method==='POST'&&url.pathname==='/api/schedule/jobs'){
    if(!connected)throw fail('连接已中断，请先断开并重新登录',401);if(busy)throw fail('查询执行中',409);const tasks=validateTasks(body.tasks);busy=true;job={id:randomBytes(16).toString('hex'),state:'running',progress:0,tasks:tasks.map(t=>({id:t.id,label:t.lane||t.vessel,state:'pending'})),blocks:[],notes:[]};void run(tasks,job);return json(202,{id:job.id});
   }
   const m=url.pathname.match(/^\/api\/schedule\/jobs\/([a-f0-9]{32})(\/export)?$/);
   if(!m||!job||m[1]!==job.id)throw fail('结果不存在或已过期',404);
   if(req.method==='GET'&&!m[2])return json(200,publicJob());
   if(req.method==='POST'&&m[2]){if(busy)throw fail('查询尚未完成',409);if(job.state==='partial'&&body.allowPartial!==true)throw fail('请确认仅导出成功结果',409);if(!Array.isArray(body.selected)||!body.selected.length||body.selected.length>10000||body.selected.some(v=>typeof v!=='string'))throw fail('请选择航次');const result=await convert(root,{operation:'export',blocks:job.blocks,notes:job.notes,selected:body.selected});expires=Date.now()+TTL;res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(result.name),'Cache-Control':'no-store'});return res.end(Buffer.from(result.data,'base64'))}
   throw fail('接口不存在',404);
  }catch(e){return json(e.safe?e.status:500,{error:e.safe?e.message:'小助手处理失败，请重试'})}
 }
 return {handle,reserved:()=>reservation,close};
}
