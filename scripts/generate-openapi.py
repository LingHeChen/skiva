import re,json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
S=lambda t,**kw:{'type':t,**kw}
ref=lambda n:{'$ref':'#/components/schemas/'+n}
obj=lambda props,required=None:{'type':'object','properties':props,**({'required':required} if required else {})}
str_=S('string');uid=S('string',format='uuid');arr=lambda i:S('array',items=i)
schemas={
'Error':obj({'error':obj({'code':str_,'message':str_,'requestId':str_,'details':S('object',additionalProperties=True)},['code','message','requestId'])},['error']),
'File':obj({'path':str_,'type':{'const':'file'},'size':S('integer',minimum=0),'digest':S('string',pattern='^sha256:[a-f0-9]{64}$'),'mode':{'type':'integer','enum':[292,365]}},['path','type','size','digest','mode']),
'Manifest':obj({'schemaVersion':{'const':1},'snapshotId':uid,'manifestDigest':str_,'generation':S('integer'),'profileId':uid,'files':arr(ref('File'))},['schemaVersion','snapshotId','manifestDigest','generation','profileId','files']),
'RepositoryInput':obj({'name':str_,'remoteUrl':str_,'defaultRef':str_,'skillRoot':str_,'credentialId':{'type':['string','null']},'webhookSecretRef':{'type':['string','null']},'status':{'enum':['active','disabled']}},['name','remoteUrl']),
'Repository':obj({'id':uid,'name':str_,'remoteUrl':str_,'defaultRef':str_,'skillRoot':str_,'status':str_,'lastCommitSha':{'type':['string','null']},'lastSyncAt':{'type':['string','null']}},['id','name','remoteUrl','status']),
'ReleaseInput':obj({'versionIds':arr(uid),'acknowledgeWarnings':S('boolean')},['versionIds']),
'PromoteInput':obj({'snapshotId':uid,'expectedGeneration':S('integer'),'reason':str_},['snapshotId','expectedGeneration','reason']),
'ProfileInput':obj({'name':str_,'channelId':uid,'consistencyMode':{'enum':['dynamic','pinned']},'offlinePolicy':{'enum':['allow_cached','deny_on_disconnect']},'pinnedSnapshotId':{'type':['string','null']},'skills':arr(str_),'enabled':S('boolean')},['name','channelId','consistencyMode','offlinePolicy','skills','enabled']),
'ClientInput':obj({'name':str_,'profileId':uid},['name','profileId']),
'LoginInput':obj({'email':S('string',format='email'),'password':S('string',writeOnly=True)},['email','password']),
'CredentialInput':obj({'name':str_,'secretRef':str_},['name','secretRef']),
'MemberInput':obj({'email':str_,'displayName':str_,'password':S('string',minLength=14,writeOnly=True),'roles':arr(str_)},['email','password','roles']),
'SettingsInput':obj({'name':str_,'policy':S('object',additionalProperties=True)},['name','policy']),
'HeartbeatInput':obj({'snapshotId':{'type':['string','null']},'generation':S('integer'),'cacheBytes':S('integer'),'cacheHits':S('integer'),'cacheMisses':S('integer'),'version':str_,'status':str_}),
'Resource':S('object',additionalProperties=True),
'Page':obj({'items':arr(ref('Resource')),'nextCursor':{'type':['string','null']}},['items','nextCursor'])}

nullable={'type':['string','null']}
schemas.update({
 'Diagnostic':obj({'ruleId':str_,'severity':{'enum':['blocker','warning']},'path':str_,'line':S('integer'),'message':str_},['ruleId','severity','path','line','message']),
 'Skill':obj({'id':uid,'name':str_,'description':nullable,'repositoryId':uid,'repositoryName':str_,'relativePath':str_,'latestVersionId':nullable},['id','name','repositoryId','relativePath']),
 'SkillVersion':obj({'id':uid,'commitSha':str_,'contentDigest':str_,'createdAt':str_,'pipelineId':uid,'metadata':obj({'name':str_,'description':str_,'files':arr(ref('File')),'diagnostics':arr(ref('Diagnostic'))})},['id','commitSha','contentDigest','metadata']),
 'PipelineStep':obj({'key':str_,'status':str_,'diagnostics':arr(ref('Diagnostic')),'startedAt':nullable,'endedAt':nullable},['key','status','diagnostics']),
 'Pipeline':obj({'id':uid,'repositoryId':uid,'repositoryName':str_,'commitSha':str_,'status':{'enum':['queued','running','succeeded','failed','cancelled']},'attempt':S('integer'),'createdAt':str_,'errorSummary':nullable,'validatorVersion':str_,'steps':arr(ref('PipelineStep'))},['id','repositoryId','commitSha','status','attempt']),
 'ReleaseItem':obj({'name':str_,'versionId':uid,'files':arr(ref('File'))},['name','versionId']),
 'Release':obj({'id':uid,'manifestDigest':str_,'createdAt':str_,'createdBy':nullable,'skillCount':S('integer'),'status':str_,'items':arr(ref('ReleaseItem'))},['id','manifestDigest']),
 'ReleasePreview':obj({'items':arr(ref('ReleaseItem')),'files':arr(ref('File')),'manifestDigest':str_,'affectedProfiles':arr(obj({'id':uid,'name':str_,'channelId':uid}))},['items','files','manifestDigest','affectedProfiles']),
 'Channel':obj({'id':uid,'name':str_,'snapshotId':nullable,'generation':S('integer'),'updatedAt':str_,'history':arr(obj({'id':uid,'beforeSnapshotId':nullable,'snapshotId':uid,'generation':S('integer'),'actorId':uid,'reason':str_,'createdAt':str_}))},['id','name','snapshotId','generation','history']),
 'Profile':obj({'id':uid,'name':str_,'channelId':uid,'channel':str_,'consistencyMode':{'enum':['dynamic','pinned']},'offlinePolicy':{'enum':['allow_cached','deny_on_disconnect']},'pinnedSnapshotId':nullable,'enabled':S('boolean'),'skills':arr(str_)},['id','name','channelId','consistencyMode','offlinePolicy','enabled','skills']),
 'MountClient':obj({'id':uid,'name':str_,'profileId':uid,'profileName':str_,'revokedAt':nullable,'lastSeenAt':nullable,'snapshotId':nullable,'expiresAt':str_,'telemetry':ref('Resource'),'status':{'enum':['online','stale','offline','revoked']}},['id','name','profileId','status','telemetry']),
 'Audit':obj({'id':uid,'actorId':str_,'action':str_,'targetType':str_,'targetId':str_,'requestId':nullable,'before':{},'after':{},'createdAt':str_},['id','actorId','action','targetType','targetId','before','after','createdAt']),
 'Member':obj({'id':uid,'email':nullable,'displayName':nullable,'active':S('boolean'),'roles':arr(str_)},['id','active','roles']),
 'Credential':obj({'id':uid,'name':str_,'secretRef':str_,'createdAt':str_},['id','name','secretRef']),
 'Notification':obj({'id':uid,'title':str_,'href':str_,'createdAt':str_,'read':S('boolean')},['id','title','href','createdAt','read']),
 'Me':obj({'id':uid,'email':nullable,'displayName':nullable,'orgId':uid,'roles':arr(str_)},['id','orgId','roles']),
 'Settings':obj({'name':str_,'policy':ref('Resource'),'oidcConfigured':S('boolean'),'production':S('boolean')},['name','policy','oidcConfigured','production']),
 'Created':obj({'id':uid},['id']),
 'CredentialIssued':obj({'id':uid,'token':S('string',description='Shown once, never persisted; omitted on idempotent replay'),'notice':str_}),
 'Promoted':obj({'channel':str_,'snapshotId':uid,'generation':S('integer'),'publishedAt':str_},['channel','snapshotId','generation','publishedAt']),
 'DistributionProfile':obj({'id':uid,'name':str_,'channelId':uid,'consistencyMode':str_,'policy':obj({'offline':str_,'leaseSeconds':S('integer')}),'activeSnapshot':nullable,'pinnedSnapshotId':nullable,'generation':S('integer')},['id','name','channelId','consistencyMode','policy','generation'])
})
list_models={'repositories':'Repository','skills':'Skill','versions':'SkillVersion','pipelines':'Pipeline','releases':'Release','channels':'Channel','profiles':'Profile','clients':'MountClient','audits':'Audit','members':'Member','credentials':'Credential','notifications':'Notification'}
for model in list_models.values():schemas[model+'Page']=obj({'items':arr(ref(model)),'nextCursor':nullable},['items','nextCursor'])

source=(root/'apps/server/internal/platform/router.go').read_text()
paths={}
for method,path,handler in re.findall(r'r\.(Get|Post|Patch|Delete)\("([^"]+)",\s*(s\.\w+)',source):
 if path!='/metrics' and not path.startswith(('/api','/distribution')):
  prefix='/distribution/v1' if handler in ['s.distributionProfile','s.manifest','s.object','s.events','s.heartbeat'] else '/api/v1'
  path=prefix+path
 method=method.lower();parameters=[{'name':p,'in':'path','required':True,'schema':str_} for p in re.findall(r'{(\w+)}',path)]
 op={'operationId':handler[2:]+'_'+method+'_'+re.sub(r'[^a-zA-Z0-9]','_',path),'security':[{'bearerAuth':[]},{'sessionCookie':[]}],'parameters':parameters,'responses':{}}
 code='200';response=ref('Resource')
 if handler in ['s.repositories','s.skills','s.versions','s.pipelines','s.releases','s.channels','s.profiles','s.clients','s.audits','s.members','s.credentials','s.notifications']:response=ref(list_models[handler[2:]]+'Page');parameters += [{'name':k,'in':'query','schema':str_} for k in ['cursor','query','repoId','status']]
 if handler=='s.manifest':response=ref('Manifest');parameters += [{'name':k,'in':'query','schema':str_} for k in ['profileId','snapshotId']]
 models={'s.repository':'Repository','s.skill':'Skill','s.pipeline':'Pipeline','s.release':'Release','s.profile':'Profile','s.client':'MountClient','s.me':'Me','s.account':'Me','s.settings':'Settings','s.saveSettings':'Settings','s.distributionProfile':'DistributionProfile','s.promote':'Promoted','s.saveRepository':'Created','s.saveProfile':'Created','s.saveCredential':'Created','s.createMember':'Created','s.createClient':'CredentialIssued'}
 if handler in models:response=ref(models[handler])
 if handler=='s.createRelease':response=ref('ReleasePreview' if path.endswith('/preview') else 'Release')
 if handler in ['s.login','s.refreshSession']:response=obj({'authenticated':S('boolean'),'expiresIn':S('integer')},['authenticated','expiresIn'])
 if handler=='s.oidcStart' or handler=='s.oidcCallback':code='302'
 if handler=='s.version':
  if path.endswith('/tree'):response=obj({'items':arr(ref('File')),'nextCursor':nullable},['items','nextCursor'])
  elif path.endswith('/file'):response=obj({'path':str_,'content':str_,'digest':str_},['path','content','digest'])
  else:response=obj({'items':arr(obj({'path':str_,'status':str_,'before':str_,'after':str_},['path','status','before','after']))},['items'])
 if handler=='s.createClient':code='201'
 if handler=='s.createRelease' and not path.endswith('/preview'):code='201'
 if handler in ['s.repositoryAction','s.retry','s.webhook'] and not path.endswith('test-connection'):code='202'
 if handler=='s.version':parameters += [{'name':k,'in':'query','schema':str_} for k in ['path','against']]
 if handler=='s.object':parameters += [{'name':'snapshotId','in':'query','required':True,'schema':uid}];op['responses']['200']={'description':'Authorized immutable bytes','content':{'application/octet-stream':{'schema':S('string',format='binary')}}};op['responses']['206']={'description':'Partial content'};op['responses']['304']={'description':'Not modified'}
 elif handler=='s.events':op['responses']['200']={'description':'Generation update hints; refetch Manifest','content':{'text/event-stream':{'schema':str_}}}
 else:op['responses'][code]={'description':'Success','content':{'application/json':{'schema':response}}}
 for status in ['400','401','403','404','409','422','429','503']:op['responses'][status]={'description':'Error','content':{'application/json':{'schema':ref('Error')}}}
 inputs={'s.saveRepository':'RepositoryInput','s.createRelease':'ReleaseInput','s.promote':'PromoteInput','s.saveProfile':'ProfileInput','s.createClient':'ClientInput','s.login':'LoginInput','s.saveCredential':'CredentialInput','s.createMember':'MemberInput','s.saveSettings':'SettingsInput','s.heartbeat':'HeartbeatInput'}
 schema=ref(inputs[handler]) if handler in inputs else None
 if method=='patch' and handler in ['s.saveRepository','s.saveProfile']:schema={k:v for k,v in schemas[inputs[handler]].items() if k!='required'}
 if handler=='s.audits':parameters += [{'name':k,'in':'query','schema':str_} for k in ['actor','action','target','from','until']]
 if handler=='s.updateMember':schema=obj({'active':S('boolean')},['active'])
 if handler=='s.account':schema=obj({'displayName':str_},['displayName'])
 if handler=='s.memberRoles':schema=obj({'roles':arr(str_)},['roles'])
 if schema:op['requestBody']={'required':True,'content':{'application/json':{'schema':schema}}}
 if handler=='s.promote':parameters.append({'name':'Idempotency-Key','in':'header','required':True,'schema':str_})
 if handler in ['s.login','s.logout','s.webhook','s.oidcStart','s.oidcCallback']:op['security']=[]
 if code=='302':op['responses']['302']={'description':'Redirect to identity provider or dashboard'}
 if path=='/metrics':op['responses']['200']={'description':'Prometheus metrics; restrict network access','content':{'text/plain':{'schema':str_}}};op['security']=[]
 paths.setdefault(path,{})[method]=op
spec={'openapi':'3.1.0','info':{'title':'Enterprise Skills Delivery Platform','version':'1.0.0'},'servers':[{'url':'http://localhost:8080','description':'Local development; production requires HTTPS'}],'paths':paths,'components':{'securitySchemes':{'bearerAuth':{'type':'http','scheme':'bearer'},'sessionCookie':{'type':'apiKey','in':'cookie','name':'skiva_session'}},'schemas':schemas}}
(root/'packages/openapi/openapi.yaml').write_text(json.dumps(spec,indent=2)+'\n')
(root/'packages/schemas/manifest.schema.json').write_text(json.dumps({'$schema':'https://json-schema.org/draft/2020-12/schema',**schemas['Manifest'],'components':{'schemas':schemas}},indent=2)+'\n')
print(f'Generated {len(paths)} API paths')
