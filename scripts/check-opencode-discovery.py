#!/usr/bin/env python3
"""Read-only OpenCode skill discovery; no model turn or global config edits."""
import json, os, subprocess, tempfile
from pathlib import Path
binary = str(Path(os.environ.get('SKIVA_OPENCODE_BIN', '.data/opencode-native/package/bin/opencode')).resolve())
with tempfile.TemporaryDirectory(prefix='skiva-opencode-') as tmp:
    project = Path(tmp)
    skill = project/'mount'/'skiva-discovery-check'
    skill.mkdir(parents=True)
    (skill/'SKILL.md').write_text('---\nname: skiva-discovery-check\ndescription: SKIVA runtime discovery fixture.\n---\nRead only fixture.\n')
    (project/'.opencode').mkdir()
    (project/'.opencode/skills').symlink_to(project/'mount', target_is_directory=True)
    env = dict(os.environ)
    for key, sub in [('XDG_CONFIG_HOME','config'),('XDG_DATA_HOME','data'),('XDG_CACHE_HOME','cache'),('XDG_STATE_HOME','state')]:
        env[key] = str(project/sub)
    subprocess.run(['git','init',str(project)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    with (project/'discovery.json').open('w') as output:
        subprocess.run([binary,'debug','skill','--pure'],cwd=project,env=env,text=True,stdout=output,stderr=subprocess.DEVNULL,timeout=90,check=True)
    data = json.loads((project/'discovery.json').read_text())
    found = [item for item in data if item.get('name') == 'skiva-discovery-check']
    assert found, 'Skill was not discovered'
    print(json.dumps({'agent':'OpenCode','version':subprocess.check_output([binary,'--version'],text=True).strip(),'discovered':[{k:v for k,v in item.items() if k in ['name','description','location']} for item in found],'modelInvoked':False},indent=2))
