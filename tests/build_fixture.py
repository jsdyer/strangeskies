import csv,tempfile,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from build import build,SCHEMA
with tempfile.TemporaryDirectory() as temp:
 folder=Path(temp)
 for name,fields in SCHEMA.items():
  with (folder/(name+'.csv')).open('w',newline='') as f:
   out=csv.DictWriter(f,fieldnames=fields);out.writeheader()
   row={k:'' for k in fields};row['cadorsnumber']='2026T0001'
   row.update({k:v for k,v in {'occurrencedate':'2026-01-01','occurrencelocation':'Test airport','subdivision_enm':'British Columbia','country_enm':'Canada','occurrencetypedescriptione':'Incident','aircraftnumber':'1','event_name_enm':'Bird strike'}.items() if k in fields})
   out.writerow(row)
 build(ROOT/'dist',folder)
