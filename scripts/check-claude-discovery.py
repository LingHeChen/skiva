#!/usr/bin/env python3
"""Query Claude Code initialization metadata only. No user/model prompt is sent."""
import json,subprocess,tempfile,time,select
from pathlib import Path
with tempfile.TemporaryDirectory(prefix='esdp-claude-') as tmp:
 project=Path(tmp);source=project/'mount';skill=source/'esdp-discovery-check';skill.mkdir(parents=True);(skill/'SKILL.md').write_text('---\nname: esdp-discovery-check\ndescription: ESDP local discovery acceptance fixture.\n---\nRead only fixture.\n');(project/'.claude').mkdir();(project/'.claude/skills').symlink_to(source,target_is_directory=True)
 proc=subprocess.Popen(['claude','-p','--input-format','stream-json','--output-format','stream-json','--verbose','--setting-sources','project','--no-session-persistence'],cwd=project,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,bufsize=1)
 try:
  proc.stdin.write(json.dumps({'type':'control_request','request_id':'esdp-init','request':{'subtype':'initialize'}})+'\n');proc.stdin.flush();end=time.time()+25;found=[];keys=[]
  while time.time()<end:
   if not select.select([proc.stdout],[],[],1)[0]:continue
   line=proc.stdout.readline()
   if not line:break
   try:data=json.loads(line)
   except json.JSONDecodeError:continue
   def walk(v):
    if isinstance(v,dict):
     if v.get('name')=='esdp-discovery-check':found.append({k:v[k] for k in ['name','description'] if k in v})
     for x in v.values():walk(x)
    elif isinstance(v,list):
     for x in v:walk(x)
    elif isinstance(v,str) and v=='esdp-discovery-check':found.append({'name':v})
   walk(data)
   if found:break
   keys.append(data.get('type','unknown'))
  result={'agent':'claude','projectSymlinkDiscovery':'PASS' if found else 'NOT_VERIFIED','modelInvoked':False,'matchingSkills':found,'messageTypes':keys}
  Path('test-results/agent-adapters/claude-runtime.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
 finally:proc.terminate();proc.wait(timeout=10)
