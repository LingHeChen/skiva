#!/usr/bin/env python3
"""Create a real Git fixture and serve its bare repository over local TLS.
Run before starting the API; configure ESDP_GIT_CA_BUNDLE and allowlist as printed.
"""
import argparse,subprocess,ssl,http.server,functools
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=9443);p.add_argument('--broken',action='store_true');args=p.parse_args()
root=Path(__file__).resolve().parents[1]/'.data/demo';root.mkdir(parents=True,exist_ok=True)
source=root/'source';bare=root/'skills.git';cert=root/'ca.pem';key=root/'key.pem'
def run(*argv,cwd=None):subprocess.run(argv,cwd=cwd,check=True,stdout=subprocess.DEVNULL)
if not cert.exists():run('openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','30','-keyout',str(key),'-out',str(cert),'-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1');key.chmod(0o600)
if not source.exists():
 source.mkdir();run('git','init','-b','main',str(source));run('git','config','user.name','ESDP Demo',cwd=source);run('git','config','user.email','demo@esdp.local',cwd=source)
 for name,description in [('sql-query','Safely inspect database schemas and compose read-only queries.'),('code-review','Review changes with traceable findings and reproducible checks.')]:
  skill=source/'skills'/name;skill.mkdir(parents=True);(skill/'references').mkdir();(skill/'SKILL.md').write_text(f'---\nname: {name}\ndescription: {description}\n---\n# {name}\n\n{description}\n\nRead [guidance](references/guide.md).\n');(skill/'references/guide.md').write_text('# Guidance\n\nReview the context before acting. Cite evidence and verify outcomes.\n')
 if args.broken:(source/'skills/code-review/references/guide.md').unlink()
 run('git','add','.',cwd=source);run('git','commit','-m','Initial enterprise skills',cwd=source);run('git','clone','--bare',str(source),str(bare))
run('git','update-server-info',cwd=bare)
print(f'Git URL: https://localhost:{args.port}/skills.git\nESDP_GIT_ALLOWLIST=localhost\nESDP_GIT_CA_BUNDLE={cert}\nSource working tree: {source}\nAfter edits: git -C {source} add . && git -C {source} commit -m update && git -C {source} push {bare} main && git -C {bare} update-server-info',flush=True)
server=http.server.ThreadingHTTPServer(('127.0.0.1',args.port),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(root)));tls=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);tls.load_cert_chain(cert,key);server.socket=tls.wrap_socket(server.socket,server_side=True);server.serve_forever()
