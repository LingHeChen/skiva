#!/usr/bin/env python3
import os,json,urllib.request,http.cookiejar,time
base=os.environ.get('SKIVA_API_URL','http://127.0.0.1:8080');jar=http.cookiejar.CookieJar();http=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
def api(path,data=None):
 req=urllib.request.Request(base+'/api/v1'+path,data=None if data is None else json.dumps(data).encode(),headers={'Content-Type':'application/json'})
 with http.open(req) as response:return json.load(response)
api('/auth/login',{'email':os.environ.get('SKIVA_ADMIN_EMAIL','admin@localhost'),'password':os.environ['SKIVA_ADMIN_PASSWORD']})
repos=api('/repositories')['items'];repo=next((r for r in repos if r['name']=='enterprise-demo'),None)
if not repo:repo=api('/repositories',{'name':'enterprise-demo','remoteUrl':'https://127.0.0.1:9443/skills.git','defaultRef':'refs/heads/main','skillRoot':'skills','status':'active'})
api('/repositories/'+repo['id']+'/sync',{})
for _ in range(90):
 runs=api('/pipelines?repoId='+repo['id'])['items']
 if runs and runs[0]['status'] in ['succeeded','failed']:
  print(json.dumps({'repositoryId':repo['id'],'pipelineId':runs[0]['id'],'status':runs[0]['status']}));break
 time.sleep(1)
else:raise SystemExit('Pipeline did not complete in 90 seconds')
