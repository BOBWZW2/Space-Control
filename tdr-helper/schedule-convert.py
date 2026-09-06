"""Bounded stdin/stdout conversion bridge. Contains no login credentials."""
import sys,json,base64
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from schedules import parse_xls,export_xlsx
try:
    raw=sys.stdin.buffer.read(32*1024*1024+1)
    if len(raw)>32*1024*1024:raise ValueError('结果过大，请缩小范围')
    v=json.loads(raw)
    if v['operation']=='parse':
        blocks,notes=parse_xls(base64.b64decode(v['data'],validate=True),v['task']); result={'blocks':blocks,'notes':notes}
    elif v['operation']=='export':
        data,name=export_xlsx(v['blocks'],set(v['selected']),v.get('notes'));result={'data':base64.b64encode(data).decode(),'name':name}
    else:raise ValueError('未知操作')
    print(json.dumps(result,ensure_ascii=True))
except ValueError as e:
    print(json.dumps({'error':str(e)},ensure_ascii=True));sys.exit(1)
except Exception:
    print(json.dumps({'error':'无法解析 Allegro 文件，请重新查询'},ensure_ascii=True));sys.exit(1)
