#!/usr/bin/env python3
"""Exercise an ISOLATED restored server. Creates a commit, canary release and test identity.
Requires SKIVA_RESTORE_API_URL, SKIVA_ADMIN_PASSWORD. Never point at production.
"""
import base64, datetime, hashlib, http.cookiejar, json, os, pathlib, subprocess, tempfile, time, urllib.request
base=os.environ['SKIVA_RESTORE_API_URL'].rstrip('/')
jar=http.cookiejar.CookieJar(); client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
def call(path,body=None,token=None):
    headers={'Content-Type':'application/json'}
    if token: headers['Authorization']='Bearer '+token
    req=urllib.request.Request(base+path,data=None if body is None else json.dumps(body).encode(),headers=headers)
    with client.open(req) as r:return json.load(r)
call('/api/v1/auth/login',{'email':os.environ.get('SKIVA_ADMIN_EMAIL','admin@localhost'),'password':os.environ['SKIVA_ADMIN_PASSWORD']})
repos=call('/api/v1/repositories')['items']; repo=next(v for v in repos if v['sourceType']=='managed' and v['provisionState']=='active')
expiry=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(hours=1)).isoformat()
pat=call('/api/v1/git-tokens',{'name':'isolated restore verification','repositoryId':repo['id'],'scopes':['repo:read','repo:write'],'expiresAt':expiry})
env=os.environ.copy();env.update({'GIT_TERMINAL_PROMPT':'0','GIT_CONFIG_COUNT':'2','GIT_CONFIG_KEY_0':'http.extraHeader','GIT_CONFIG_VALUE_0':'Authorization: Basic '+base64.b64encode(('restore:'+pat['token']).encode()).decode(),'GIT_CONFIG_KEY_1':'credential.helper','GIT_CONFIG_VALUE_1':''})
def git(*args):
    proc=subprocess.run(['git',*args],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    if proc.returncode:raise RuntimeError('Git verification failed: '+proc.stderr)
    return proc.stdout.strip()
with tempfile.TemporaryDirectory() as temp:
    work=str(pathlib.Path(temp)/'repo');url=base+'/git/'+repo['namespace']+'/'+repo['slug']+'.git'
    git('clone',url,work);git('-C',work,'config','user.name','Restore verification');git('-C',work,'config','user.email','restore@localhost')
    pathlib.Path(work,'restore-check.md').write_text('Verified isolated restore '+datetime.datetime.now(datetime.timezone.utc).isoformat()+'\n')
    git('-C',work,'add','.');git('-C',work,'commit','-m','Verify isolated restore');git('-C',work,'push','origin','HEAD');git('-C',work,'fetch','origin');sha=git('-C',work,'rev-parse','HEAD')
    deadline=time.monotonic()+90
    while time.monotonic()<deadline:
        runs=call('/api/v1/pipelines?repoId='+repo['id'])['items'];run=next((v for v in runs if v['commitSha']==sha),None)
        if run and run['status']=='succeeded':break
        if run and run['status']=='failed':raise RuntimeError('Restored pipeline failed')
        time.sleep(1)
    else:raise RuntimeError('Restored pipeline timed out')
skill=next(v for v in call('/api/v1/skills')['items'] if v['repositoryId']==repo['id'])
version=next(v for v in call('/api/v1/skills/'+skill['id']+'/versions')['items'] if v['commitSha']==sha)
release=call('/api/v1/releases',{'versionIds':[version['id']],'acknowledgeWarnings':True})
channel=next(v for v in call('/api/v1/channels')['items'] if v['name']=='canary')
req=urllib.request.Request(base+'/api/v1/channels/'+channel['id']+'/promote',data=json.dumps({'snapshotId':release['id'],'expectedGeneration':channel['generation'],'reason':'Isolated backup restore verification'}).encode(),headers={'Content-Type':'application/json','Idempotency-Key':'restore-'+sha})
with client.open(req) as response:json.load(response)
profile=call('/api/v1/agent-profiles',{'name':'restore-'+sha[:12],'channelId':channel['id'],'consistencyMode':'dynamic','offlinePolicy':'deny_on_disconnect','enabled':True,'skills':[skill['name']]})
agent=call('/api/v1/mount-clients',{'name':'restore-check','profileId':profile['id']})
manifest=call('/distribution/v1/manifest',token=agent['token'])
for f in manifest['files']:
    req=urllib.request.Request(base+'/distribution/v1/objects/'+f['digest']+'?snapshotId='+manifest['snapshotId'],headers={'Authorization':'Bearer '+agent['token']})
    with urllib.request.urlopen(req) as response:data=response.read()
    assert 'sha256:'+hashlib.sha256(data).hexdigest()==f['digest']
call('/api/v1/git-tokens/'+pat['id']+'/revoke',{})
print('PASS: restored Git clone/fetch/push → fixed-SHA pipeline → release/canary → profile/manifest → verified blobs; PAT revoked')
