import unittest,io,zipfile,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from datetime import datetime,timezone,timedelta
from schedules import export_xlsx
class ExportTest(unittest.TestCase):
 def test_selection_layout_and_filename(self):
  raw=[{'id':'a','hasVessel':True,'cells':['2026-35','=SAFE','','SHIP','2635','E','','09/01','09/02','']},{'id':'b','hasVessel':False,'cells':['2026-36','','','','','','','','','']},{'id':'c','hasVessel':True,'cells':['2026-37','BOAT','','SHIP','2637','E','','09/15','09/16','']}]
  b={'sheet':'CGX','source':'CGX1','ports':['SGSIN'],'rows':[{'id':r['id'],'vessel':r['cells'][1]} for r in raw],'_raw':raw,'_cols':10,'_header':[['Week','Vessel','','Code','Voyage','Dir','','Port','','Remark'],['','','','','','','','SGSIN','',''],['','','','','','','','ETA','ETD',''],['']*10],'_merges':[[0,1,7,9]]}
  data,name=export_xlsx([b],{'a','c'})
  self.assertEqual(name,datetime.now(timezone(timedelta(hours=8))).strftime('Vessel Schedules (%d.%m.%y).xlsx'))
  with zipfile.ZipFile(io.BytesIO(data)) as z:
   xml=z.read('xl/worksheets/sheet1.xml').decode();self.assertIn('2026-36',xml);self.assertIn('=SAFE',xml);self.assertNotIn('<f>',xml);self.assertIn('topLeftCell="H7"',xml);self.assertIn('H3:I3',xml)
  with self.assertRaises(ValueError):export_xlsx([b],{'unknown'})
  with self.assertRaises(ValueError):export_xlsx([b],{'b'})
if __name__=='__main__':unittest.main()
