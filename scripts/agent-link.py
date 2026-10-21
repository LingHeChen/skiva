#!/usr/bin/env python3
"""Link a verified mount into an explicitly chosen project; never edits user-global settings."""
import argparse,json,os
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--source-mount-path',required=True);p.add_argument('--project',required=True);p.add_argument('--agent',choices=['codex','claude','opencode'],required=True);p.add_argument('--check',action='store_true');a=p.parse_args()
source=Path(a.source_mount_path).resolve(strict=True);project=Path(a.project).resolve(strict=True);destination=project/{'codex':'.agents/skills','claude':'.claude/skills','opencode':'.opencode/skills'}[a.agent]
files=list(source.glob('*/SKILL.md'))
if not files:raise SystemExit('No top-level Skill directories found in source mount')
if not a.check:
 if destination.exists() or destination.is_symlink():raise SystemExit(f'Refusing to replace existing path: {destination}')
 destination.parent.mkdir(parents=True,exist_ok=True);destination.symlink_to(source,target_is_directory=True)
if not destination.exists():raise SystemExit(f'Agent path unavailable: {destination}')
results=[]
for file in files:
 target=destination/file.parent.name/'SKILL.md';text=target.read_text();results.append({'skill':file.parent.name,'readable':bool(text),'bytes':target.stat().st_size})
print(json.dumps({'agent':a.agent,'sourceMountPath':str(source),'agentSkillsPath':str(destination),'directoryReadChecks':results,'runtimeDiscovery':'not tested by this filesystem adapter'},indent=2))
