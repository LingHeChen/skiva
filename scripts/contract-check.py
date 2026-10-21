#!/usr/bin/env python3
import os,json,urllib.request,http.cookiejar,re
from pathlib import Path
import jsonschema
spec=json.loads(Path('packages/openapi/openapi.yaml').read_text());jar=http.cookiejar.CookieJar();client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar));base=os.environ.get('SKIVA_API_URL','http://127.0.0.1:8080')
def call(path,body=None):
 req=urllib.request.Request(base+path,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json'})
 with client.open(req) as response:return response.status,json.load(response)
call('/api/v1/auth/login',{'email':os.environ.get('SKIVA_ADMIN_EMAIL','admin@localhost'),'password':os.environ['SKIVA_ADMIN_PASSWORD']})
def verify(path,template=None):
 status,data=call(path);template=template or path;schema=spec['paths'][template]['get']['responses'][str(status)]['content']['application/json']['schema'];resolved={**schema,'components':spec['components']};jsonschema.Draft202012Validator(resolved).validate(data);return data
count=0
for resource in ['me','dashboard','repositories','skills','pipelines','releases','channels','agent-profiles','mount-clients','audit-logs','members','settings','credentials','notifications']:
 path='/api/v1/'+resource;data=verify(path);count+=1
 if resource in ['repositories','skills','pipelines','releases','agent-profiles','mount-clients']:
  for item in data['items'][:2]:verify(path+'/'+item['id'],path+'/{id}');count+=1
 if resource=='skills':
  for item in data['items'][:2]:
   versions=verify(path+'/'+item['id']+'/versions',path+'/{id}/versions');count+=1
   for version in versions['items'][:1]:
    verify('/api/v1/skill-versions/'+version['id']+'/tree','/api/v1/skill-versions/{id}/tree');verify('/api/v1/skill-versions/'+version['id']+'/file?path=SKILL.md','/api/v1/skill-versions/{id}/file');count+=2
print(f'PASS: {count} live API responses validated against OpenAPI 3.1 schemas')
