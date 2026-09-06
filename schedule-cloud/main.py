"""Single-process cloud browser runner. Credentials and schedules stay ephemeral."""
import asyncio,hmac,os,re,secrets,time,uuid,tempfile
from pathlib import Path
from urllib.parse import urlparse,quote
from contextlib import asynccontextmanager
from datetime import date
from fastapi import FastAPI,Request,HTTPException
from fastapi.responses import JSONResponse,Response
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel,Field,ConfigDict,SecretStr,field_validator
from playwright.async_api import async_playwright
from schedules import parse_xls,public_blocks,export_xlsx
ORIGIN='https://ops.culines.com';LOGIN=ORIGIN+'/oceans/nawlogon.do';MAIN=ORIGIN+'/oceans/webfw/html/nawmain.html';TTL=1800
sessions={};jobs={};owners={};attempts={};background=set();gate=asyncio.Semaphore(1)
async def release(sid):
    s=sessions.pop(sid,None)
    if s:
        if owners.get(s['account'])==sid:owners.pop(s['account'],None)
        await s['context'].close()
        for jid,j in list(jobs.items()):
            if j['sid']==sid:jobs.pop(jid,None)
async def sweep():
    while True:
        await asyncio.sleep(45)
        for sid,s in list(sessions.items()):
            if s['expires']<time.time() and not s['busy']:await release(sid)
        for actor,items in list(attempts.items()):
            recent=[t for t in items if t>time.time()-300]
            if recent:attempts[actor]=recent
            else:attempts.pop(actor,None)
@asynccontextmanager
async def lifespan(app):
    if len(os.environ.get('RUNNER_TOKEN',''))<32:raise RuntimeError('Set a random RUNNER_TOKEN of at least 32 characters')
    pw=await async_playwright().start();app.state.browser=await pw.chromium.launch(headless=True,chromium_sandbox=True,args=['--disable-dev-shm-usage']);task=asyncio.create_task(sweep())
    try:yield
    finally:
        task.cancel()
        for t in list(background):t.cancel()
        await asyncio.gather(*background,return_exceptions=True)
        for sid in list(sessions):await release(sid)
        await app.state.browser.close();await pw.stop()
app=FastAPI(lifespan=lifespan,docs_url=None,redoc_url=None,openapi_url=None)
@app.exception_handler(HTTPException)
async def expected(request,e):return JSONResponse({'error':str(e.detail)},status_code=e.status_code)
@app.exception_handler(RequestValidationError)
async def invalid(request,e):return JSONResponse({'error':'请求字段无效'},status_code=400)
@app.exception_handler(Exception)
async def unexpected(request,e):return JSONResponse({'error':'抓取服务处理失败，请重试'},status_code=500)
@app.middleware('http')
async def security(req,call_next):
    if req.url.path=='/healthz':return JSONResponse({'ready':bool(getattr(app.state,'browser',None))})
    token=os.environ.get('RUNNER_TOKEN','')
    if len(token)<32 or not hmac.compare_digest(req.headers.get('authorization',''),'Bearer '+token):return JSONResponse({'error':'服务授权无效'},status_code=401)
    actor=req.headers.get('x-actor','')
    if not actor or len(actor)>200:return JSONResponse({'error':'身份无效'},status_code=401)
    size=req.headers.get('content-length','0')
    if not size.isdigit() or int(size)>131072:return JSONResponse({'error':'请求过大'},status_code=413)
    if len(await req.body())>131072:return JSONResponse({'error':'请求过大'},status_code=413)
    r=await call_next(req);r.headers['Cache-Control']='no-store';return r

def get_session(req):
    sid=req.headers.get('x-session','');s=sessions.get(sid)
    if not s or s['actor']!=req.headers['x-actor'] or (s['expires']<time.time() and not s['busy']):raise HTTPException(401,'Allegro 会话已过期，请重新登录')
    return sid,s

def get_job(req,jid):
    sid,_=get_session(req);j=jobs.get(jid)
    if not j or j['sid']!=sid or j['actor']!=req.headers['x-actor']:raise HTTPException(404,'结果不存在或已过期')
    return j
class Login(BaseModel):
    model_config=ConfigDict(extra='forbid')
    username:str=Field(min_length=1,max_length=100)
    password:SecretStr=Field(min_length=1,max_length=256)
    office:str=Field(default='',pattern=r'^[A-Z0-9]{0,8}$')
@app.get('/v1/status')
async def status(request:Request):
    try:sid,s=get_session(request)
    except HTTPException:return {'connected':False}
    return {'connected':True,'office':s['office'],'jobId':next((jid for jid,j in jobs.items() if j['sid']==sid),None)}
@app.post('/v1/login')
async def login(body:Login,request:Request):
    actor=request.headers['x-actor'];recent=[t for t in attempts.get(actor,[]) if t>time.time()-300]
    if len(recent)>=5:raise HTTPException(429,'登录尝试较多，请五分钟后重试')
    attempts[actor]=recent+[time.time()];account=body.username.casefold()
    if owners.get(account):raise HTTPException(409,'该 Allegro 账号已有连接，请在原电脑断开或等待会话过期')
    if len(owners)>=int(os.environ.get('MAX_SESSIONS','1')):raise HTTPException(429,'当前连接较多，请稍后再试')
    sid=secrets.token_urlsafe(32);owners[account]=sid;context=None
    try:
        context=await app.state.browser.new_context(accept_downloads=True,locale='en-US',viewport={'width':1440,'height':1000})
        async def guard(route):
            u=urlparse(route.request.url)
            if u.scheme in ('data','blob','about') or (u.scheme=='https' and u.netloc=='ops.culines.com'):await route.continue_()
            else:await route.abort()
        await context.route('**/*',guard);page=await context.new_page();page.set_default_timeout(20000)
        page.on('dialog',lambda d:asyncio.create_task(d.dismiss()))
        await page.goto(LOGIN,wait_until='domcontentloaded',timeout=45000)
        await page.locator('#userId').fill(body.username);await page.locator('#userPw').fill(body.password.get_secret_value());await page.locator('#btnLogin').click()
        await page.wait_for_url(re.compile(r'/oceans/webfw/html/nawmain\.html'),timeout=45000)
        await page.get_by_role('button',name='Menu',exact=True).wait_for()
        if not await page.get_by_text(body.username,exact=True).count():raise ValueError()
        office=page.get_by_role('combobox').nth(0)
        if body.office:await office.select_option(label=body.office)
        value=await office.input_value();sessions[sid]={'actor':actor,'account':account,'context':context,'page':page,'office':value,'expires':time.time()+TTL,'busy':False}
        return {'session':sid,'office':value}
    except Exception:
        if context:await context.close()
        if owners.get(account)==sid:owners.pop(account,None)
        raise HTTPException(401,'未能登录 Allegro，请核对账号、密码和 Office；如出现验证码或会话限制，需要先处理')
@app.post('/v1/logout')
async def logout(request:Request):
    sid,s=get_session(request)
    if s['busy']:raise HTTPException(409,'查询运行中，请完成后断开')
    await release(sid);return {'ok':True}
class Query(BaseModel):
    model_config=ConfigDict(extra='forbid')
    id:str=Field(pattern=r'^[a-f0-9-]{36}$');enabled:bool=True
    lane:str=Field(default='',pattern=r'^[A-Z0-9]{0,8}$');vessel:str=Field(default='',pattern=r'^[A-Z0-9]{0,8}$')
    sheet:str=Field(min_length=1,max_length=31);period:str=Field(pattern=r'^(Date|Week|Quarter)$')
    from_:str=Field(alias='from',max_length=16);to:str=Field(max_length=16);dates:list[str]=Field(min_length=2,max_length=2)
    @field_validator('sheet')
    @classmethod
    def check_sheet(cls,v):
        if re.search(r'[\[\]:*?/\\]',v) or v.startswith("'") or v.endswith("'"):raise ValueError()
        return v
class Queries(BaseModel):
    model_config=ConfigDict(extra='forbid')
    tasks:list[Query]=Field(min_length=1,max_length=30)
class Selection(BaseModel):
    model_config=ConfigDict(extra='forbid')
    selected:list[str]=Field(min_length=1,max_length=10000);allowPartial:bool=False
async def open_schedule(s):
    p=s['page'];await p.goto(MAIN,wait_until='domcontentloaded',timeout=45000)
    await p.get_by_role('button',name='Menu',exact=True).click();await p.get_by_text('Marine',exact=True).click();await p.get_by_text('Vessel Schedule',exact=True).nth(0).click();await p.get_by_text('Vessel Schedule',exact=True).nth(1).click();await p.get_by_text('Search',exact=True).click();await p.get_by_text('Search Long Range Schedule',exact=True).click()
    for _ in range(40):
        for f in p.frames:
            if f!=p.main_frame and await f.get_by_role('heading',name='Search Long Range Schedule',exact=True).count():return f
        await asyncio.sleep(.25)
    raise ValueError('查询页面未加载')
async def set_date(f,field,v):
    y,m,d=map(int,v.split('-'));await f.locator('#img_'+field).click();await f.locator('#calyear').select_option(str(y));await f.locator('#calmonth').select_option(str(m-1));await f.locator(f'a[href="#{d}"]:not(.caloff)').click()
    if await f.locator('#'+field).input_value()!=v:raise ValueError('日期设置不一致')
async def query_xls(s,t,state):
    f=await open_schedule(s)
    if t['lane']:await f.locator('#vslSvceLaneCd').fill(t['lane'])
    if t['vessel']:await f.locator('#vslCd').fill(t['vessel'])
    # UI discloses normalization of ISO weeks / calendar quarters to Date mode.
    await f.locator('#radioPeriod2').check();await set_date(f,'fmDt',t['dates'][0]);await set_date(f,'toDt',t['dates'][1]);await f.get_by_role('button',name='Search',exact=True).click()
    deadline=time.monotonic()+60
    while time.monotonic()<deadline:
        text=await f.locator('body').inner_text()
        if 'Result :' in text:break
        if re.search(r'no data|no records|not found',text,re.I):return [],[]
        await asyncio.sleep(.5)
    else:raise ValueError('无明确查询结果，未导出旧数据')
    state['state']='downloading'
    async with s['page'].expect_download(timeout=60000) as pending:await f.get_by_role('button',name='Export Excel',exact=True).click()
    d=await pending.value
    try:
        if await d.failure():raise ValueError('下载失败')
        with tempfile.TemporaryDirectory(prefix='allegro-') as folder:
            p=Path(folder)/'schedule.xls';await d.save_as(str(p))
            if p.stat().st_size>8*1024*1024:raise ValueError('原始文件过大')
            return await asyncio.to_thread(parse_xls,p.read_bytes(),t)
    finally:await d.delete()
@app.post('/v1/jobs')
async def start(body:Queries,request:Request):
    sid,s=get_session(request)
    if s['busy']:raise HTTPException(409,'当前连接已有查询执行中')
    tasks=[t.model_dump(by_alias=True) for t in body.tasks if t.enabled]
    if not tasks or len({t['id'] for t in tasks})!=len(tasks):raise HTTPException(400,'查询为空或重复')
    for t in tasks:
        try:
            a,b=map(date.fromisoformat,t['dates'])
            if not(t['lane'] or t['vessel']) or a>b or (b-a).days>366:raise ValueError()
        except ValueError:raise HTTPException(400,'查询条件或日期范围无效')
    for old,j in list(jobs.items()):
        if j['sid']==sid:jobs.pop(old,None)
    jid=uuid.uuid4().hex;s['busy']=True;jobs[jid]={'id':jid,'sid':sid,'actor':s['actor'],'state':'running','progress':0,'tasks':[{'id':t['id'],'label':t['lane'] or t['vessel'],'state':'pending'} for t in tasks],'blocks':[],'notes':[]}
    task=asyncio.create_task(run_job(jid,s,tasks));background.add(task);task.add_done_callback(background.discard);return {'id':jid}
async def run_job(jid,s,tasks):
    j=jobs[jid]
    try:
        async with gate:
            for i,t in enumerate(tasks):
                state=j['tasks'][i];state['state']='querying'
                try:
                    blocks,notes=await asyncio.wait_for(query_xls(s,t,state),240)
                    if sum(len(b['rows']) for b in j['blocks']+blocks)>10000:raise ValueError('结果过多')
                    j['blocks'].extend(blocks);j['notes'].extend([[t['lane'] or t['vessel']]+r for r in notes]);state['state']='complete' if blocks else 'empty'
                except Exception:state.update(state='failed',message='查询或下载未完成，请重试')
                j['progress']=(i+1)/len(tasks)*100
            failed=any(t['state']=='failed' for t in j['tasks']);j['state']='partial' if failed and j['blocks'] else 'failed' if failed else 'complete'
    finally:s['busy']=False;s['expires']=time.time()+TTL
@app.get('/v1/jobs/{jid}')
async def job(jid:str,request:Request):
    j=get_job(request,jid);return {k:j[k] for k in ('id','state','progress','tasks')}|{'blocks':public_blocks(j['blocks']) if j['state']!='running' else []}
@app.post('/v1/jobs/{jid}/export')
async def export(jid:str,body:Selection,request:Request):
    j=get_job(request,jid)
    if j['state']=='running':raise HTTPException(409,'查询尚未完成')
    if j['state']=='partial' and not body.allowPartial:raise HTTPException(409,'部分查询失败，请确认仅导出成功结果')
    try:data,name=await asyncio.to_thread(export_xlsx,j['blocks'],set(body.selected),j['notes'])
    except ValueError as e:raise HTTPException(400,str(e))
    return Response(data,media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',headers={'Content-Disposition':"attachment; filename*=UTF-8''"+quote(name)})
