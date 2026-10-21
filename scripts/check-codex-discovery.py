#!/usr/bin/env python3
"""Read-only app-server discovery check. Does not start a thread, model turn or send a user prompt."""
import json,subprocess,tempfile,time,select
from pathlib import Path
with tempfile.TemporaryDirectory(prefix='skiva-agent-') as tmp:
 project=Path(tmp);source=project/'mount';skill=source/'skiva-discovery-check';skill.mkdir(parents=True)
 file=skill/'SKILL.md';file.write_text('---\nname: skiva-discovery-check\ndescription: SKIVA discovery initial marker.\n---\nRead only fixture.\n')
 (project/'.agents').mkdir();(project/'.agents/skills').symlink_to(source,target_is_directory=True)
 subprocess.run(['git','init',str(project)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
 proc=subprocess.Popen(['codex','app-server','--stdio'],cwd=project,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,bufsize=1)
 def send(payload):proc.stdin.write(json.dumps(payload)+'\n');proc.stdin.flush()
 def response(id):
  end=time.time()+25
  while time.time()<end:
   if select.select([proc.stdout],[],[],1)[0]:
    line=proc.stdout.readline()
    if not line:break
    try:data=json.loads(line)
    except json.JSONDecodeError:continue
    if data.get('id')==id:return data
  raise RuntimeError('app-server response timeout')
 try:
  send({'id':1,'method':'initialize','params':{'clientInfo':{'name':'skiva-validation','version':'1.0'},'capabilities':{'experimentalApi':True}}});response(1);send({'method':'initialized','params':{}})
  def listing(id):
   send({'id':id,'method':'skills/list','params':{'cwds':[str(project)],'forceReload':True}})
   out=response(id);found=[]
   def walk(v):
    if isinstance(v,dict):
     if v.get('name')=='skiva-discovery-check':found.append({k:v[k] for k in ['name','description','path'] if k in v})
     for x in v.values():walk(x)
    elif isinstance(v,list):
     for x in v:walk(x)
   walk(out)
   if not found:raise RuntimeError('test skill not discovered: '+str(out.get('error','no matching name')))
   return found
  initial=listing(2);file.write_text(file.read_text().replace('initial marker','updated marker'));updated=listing(3)
  if not any('updated marker' in v.get('description','') for v in updated):raise RuntimeError('forceReload did not discover updated metadata')
  result={'agent':'codex','version':subprocess.check_output(['codex','--version'],text=True).strip(),'projectSymlinkDiscovery':'PASS','forceReload':'PASS','modelInvoked':False,'initial':initial,'updated':updated}
  Path('test-results/agent-adapters/codex-runtime.json').resolve().parent.mkdir(parents=True,exist_ok=True)
  # cwd of this Python process remains the project root, only child cwd is temporary.
  Path('test-results/agent-adapters/codex-runtime.json').write_text(json.dumps(result,indent=2))
  print('PASS Codex real app-server Skill discovery and explicit reload; no model invocation')
 finally:proc.terminate();proc.wait(timeout=10)
