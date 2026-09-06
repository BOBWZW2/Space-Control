"""Native Allegro XLS parsing and selected-row OOXML export. No formulas executed."""
import io,re,zipfile
from collections import OrderedDict
from datetime import datetime
from zoneinfo import ZoneInfo
from xml.sax.saxutils import escape,quoteattr
import xlrd

def cell(book,c):
    if c.ctype==xlrd.XL_CELL_DATE:return xlrd.xldate_as_datetime(c.value,book.datemode).strftime('%m/%d')
    if isinstance(c.value,float) and c.value.is_integer():return str(int(c.value))
    return str(c.value).replace('\xa0',' ')

def parse_xls(data,task):
    if len(data)>8*1024*1024:raise ValueError('原始文件超过 8MB，请缩小查询范围')
    book=xlrd.open_workbook(file_contents=data,formatting_info=True)
    if book.nsheets>50:raise ValueError('工作表过多')
    blocks=[];notes=[];found=False
    for si,s in enumerate(book.sheets()):
        if s.nrows*s.ncols>200000 or s.ncols>512:raise ValueError('船期表过大')
        v=[[cell(book,s.cell(r,c)) for c in range(s.ncols)] for r in range(s.nrows)]
        if not v or not v[0]:continue
        if s.name.casefold()=='remark':notes.extend(r for r in v[3:] if any(r));continue
        if 'long range schedule' not in v[0][0].lower():continue
        found=True
        if task.get('lane') and not any(f'[{task["lane"]}]' in x for x in v[0]):raise ValueError('原始文件航线与查询不符')
        starts=[i for i,r in enumerate(v) if r[0]=='Week']
        for bi,start in enumerate(starts):
            if start+4>=len(v):continue
            end=starts[bi+1] if bi+1<len(starts) else len(v)
            head=v[start:start+4];remark=next((i for i,x in enumerate(head[0]) if x=='Remark'),s.ncols)
            rows=[];raw=[]
            for r in range(start+4,end):
                cells=v[r]
                if not re.fullmatch(r'\d{4}-\d{2}',cells[0]):continue
                if task.get('vessel') and cells[1] and cells[3]!=task['vessel']:raise ValueError('原始文件船舶与查询不符')
                rid=f'{task["id"]}:{si}:{bi}:{r}'
                raw.append({'id':rid,'cells':cells,'hasVessel':bool(cells[1])})
                rows.append({'id':rid,'week':cells[0],'vessel':cells[1],'code':cells[3],'voyage':cells[4],'direction':cells[5],'dates':cells[7:remark]})
            if any(r['vessel'] for r in rows):blocks.append({'id':f'{task["id"]}:{si}:{bi}','sheet':task['sheet'],'source':s.name,'ports':[head[1][i] for i in range(7,remark,2)],'rows':rows,'_raw':raw,'_header':head,'_cols':s.ncols,'_merges':[[r0-start,r1-start,c0,c1] for r0,r1,c0,c1 in s.merged_cells if start<=r0 and r1<=start+4]})
    if not found:raise ValueError('文件不是 Long Range Schedule')
    return blocks,notes

def public_blocks(blocks):return [{k:v for k,v in b.items() if not k.startswith('_')} for b in blocks]
def col(i):
    s='';i+=1
    while i:i,r=divmod(i-1,26);s=chr(65+r)+s
    return s
def clean(s):return re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]','',str(s))[:32767]
def sheet_xml(rows,merges,widths,freeze=True):
    out=['<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>']
    if freeze:out.append('<sheetViews><sheetView workbookViewId="0"><pane xSplit="7" ySplit="6" topLeftCell="H7" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>')
    out.append('<cols>'+''.join(f'<col min="{i+1}" max="{i+1}" width="{w}" customWidth="1"/>' for i,w in enumerate(widths))+'</cols><sheetData>')
    for r,(values,style,height) in enumerate(rows,1):
        out.append(f'<row r="{r}" ht="{height}" customHeight="1">')
        for c,x in enumerate(values):out.append(f'<c r="{col(c)}{r}" s="{style}" t="inlineStr"><is><t xml:space="preserve">{escape(clean(x))}</t></is></c>')
        out.append('</row>')
    out.append('</sheetData>')
    if merges:out.append(f'<mergeCells count="{len(merges)}">'+''.join(f'<mergeCell ref="{col(c0)}{r0+1}:{col(c1-1)}{r1}"/>' for r0,r1,c0,c1 in merges)+'</mergeCells>')
    out.append('<pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0.2" footer="0.2"/><pageSetup orientation="landscape" paperSize="8" fitToWidth="1" fitToHeight="0"/></worksheet>')
    return ''.join(out)
STYLES='''<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><b/><sz val="14"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF969696"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFB8B8B8"/></left><right style="thin"><color rgb="FFB8B8B8"/></right><top style="thin"><color rgb="FFB8B8B8"/></top><bottom style="thin"><color rgb="FFB8B8B8"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'''

def export_xlsx(blocks,selected,notes=None):
    valid={r['id'] for b in blocks for r in b['rows']}
    if not selected or not selected<=valid:raise ValueError('选择的行不存在或已过期')
    if not any(r['id'] in selected and r['vessel'] for b in blocks for r in b['rows']):raise ValueError('请至少选择一个航次')
    groups=OrderedDict();seen=set()
    for b in blocks:
        indexes=[i for i,r in enumerate(b['_raw']) if r['id'] in selected]
        if not indexes or not any(r['id'] in selected and r['hasVessel'] for r in b['_raw']):continue
        name=b['sheet']
        if not name or len(name)>31 or re.search(r'[\[\]:*?/\\]',name) or name.startswith("'") or name.endswith("'"):raise ValueError('Sheet 名称无效')
        key=name.casefold();kept=[]
        for i,r in enumerate(b['_raw']):
            if r['id'] in selected or (not r['hasVessel'] and min(indexes)<=i<=max(indexes)):
                fingerprint=(key,b['source'],tuple(b['ports']),tuple(r['cells']))
                if r['hasVessel'] and fingerprint in seen:continue
                if r['hasVessel']:seen.add(fingerprint)
                kept.append(r['cells'])
        if any(r[1] for r in kept):groups.setdefault(key,{'name':name,'parts':[]})['parts'].append((b,kept))
    sheets=[]
    for g in groups.values():
        n=max(b['_cols'] for b,_ in g['parts']);rows=[([f'[{g["name"]}] Long Range Schedule'],3,28),([],0,10)];merges=[[0,1,0,n]]
        for i,(b,kept) in enumerate(g['parts']):
            if i:rows.extend([([],0,10),([],0,10)])
            offset=len(rows);rows.extend((r,1,23) for r in b['_header']);merges.extend([r0+offset,r1+offset,c0,c1] for r0,r1,c0,c1 in b['_merges']);rows.extend((r,2,26) for r in kept)
        sheets.append((g['name'],sheet_xml(rows,merges,[11,27,10,10,9,7,18]+[9]*(n-8)+[24])))
    if notes:
        name='Source Remarks';i=1
        while name.casefold() in groups:name=f'Source Remarks {i}';i+=1
        sheets.append((name,sheet_xml([(['Source query','Vessel Voyage','No','Remark'],1,25)]+[(r,2,40) for r in notes],[],[24,22,8,85],False)))
    buf=io.BytesIO();rel='http://schemas.openxmlformats.org/package/2006/relationships';doc='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    with zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+''.join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(1,len(sheets)+1))+'</Types>')
        z.writestr('_rels/.rels',f'<Relationships xmlns="{rel}"><Relationship Id="rId1" Type="{doc}/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        z.writestr('xl/workbook.xml',f'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="{doc}"><sheets>'+''.join(f'<sheet name={quoteattr(n)} sheetId="{i}" r:id="rId{i}"/>' for i,(n,_) in enumerate(sheets,1))+'</sheets></workbook>')
        z.writestr('xl/_rels/workbook.xml.rels',f'<Relationships xmlns="{rel}">'+''.join(f'<Relationship Id="rId{i}" Type="{doc}/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in range(1,len(sheets)+1))+f'<Relationship Id="styles" Type="{doc}/styles" Target="styles.xml"/></Relationships>')
        z.writestr('xl/styles.xml',STYLES)
        for i,(_,xml) in enumerate(sheets,1):z.writestr(f'xl/worksheets/sheet{i}.xml',xml)
    return buf.getvalue(),f'Vessel Schedules ({datetime.now(ZoneInfo("Asia/Singapore")):%d.%m.%y}).xlsx'
