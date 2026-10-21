"""Local, isolated managed Git -> release -> Linux FUSE -> real model acceptance."""
import base64
import datetime as dt
import http.cookiejar
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.request
import uuid

from pydantic import BaseModel
from pydantic_ai import Agent, RunContext
from pydantic_ai.capabilities import Caching, Instrumentation
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.providers.anthropic import AnthropicProvider
from pydantic_ai.models.instrumented import InstrumentationSettings
from pydantic_ai.usage import UsageLimits
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor, ConsoleSpanExporter

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / '.data/agent-pilot'
OUT.mkdir(parents=True, exist_ok=True)
BASE = os.environ.get('SKIVA_PILOT_URL', 'http://127.0.0.1:8083')
if BASE != 'http://127.0.0.1:8083':
    raise SystemExit('Pilot requires the isolated loopback server on port 8083')
CONTAINER = 'skiva-agent-fuse'
MOUNT = '/opt/skiva/skills-mount-linux-' + os.environ.get('SKIVA_PILOT_ARCH', 'arm64')
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

def api(path, body=None):
    req = urllib.request.Request(BASE + '/api/v1' + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={'Content-Type': 'application/json', 'Idempotency-Key': str(uuid.uuid4())})
    with HTTP.open(req, timeout=30) as response:
        return json.load(response)

def command(*args, env=None):
    result = subprocess.run(args, env=env, capture_output=True, text=True, timeout=120)
    if result.returncode:
        # Git and model credentials must never be echoed in exception messages.
        raise RuntimeError(f'{args[0]} failed (exit {result.returncode})')
    return result.stdout.strip()

def docker(*args):
    return command('docker', 'exec', CONTAINER, *args)

def wait_for(fn, timeout=90):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        value = fn()
        if value:
            return value
        time.sleep(1)
    raise TimeoutError('Pilot operation timed out')

class Decision(BaseModel):
    approved: bool
    policy_version: str
    limit_yuan: int
    reason: str


def main():
    api('/auth/login', {'email': os.environ.get('SKIVA_ADMIN_EMAIL', 'admin@localhost'), 'password': os.environ['SKIVA_ADMIN_PASSWORD']})
    name = 'expense-' + uuid.uuid4().hex[:8]
    repo = api('/repositories', {'name': name, 'sourceType': 'managed', 'namespace': 'agent-pilot', 'slug': name, 'template': 'single', 'defaultRef': 'refs/heads/main'})
    wait_for(lambda: next((r for r in api('/repositories')['items'] if r['id'] == repo['id'] and r['provisionState'] == 'active'), None))
    records = []
    clients = []
    trace_file = (OUT / 'traces.jsonl').open('w')
    tracer = TracerProvider()
    tracer.add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter(out=trace_file, formatter=lambda span: span.to_json(indent=None) + "\n")))
    model = AnthropicModel(os.environ.get('MINIMAX_M2_MODEL', 'MiniMax-M2'), provider=AnthropicProvider(base_url=os.environ['MINIMAX_M2_BASE_URL'], api_key=os.environ['MINIMAX_M2_AUTH_TOKEN']))
    agent = Agent(model, name='skiva_expense_agent', output_type=Decision, deps_type=str,
        instructions='Decide a synthetic expense claim. Always call read_skill first, follow its current policy exactly. Return the policy version and limit from that file. Do not invent policies.',
        capabilities=[Caching(), Instrumentation(InstrumentationSettings(tracer_provider=tracer, include_content=False))])

    @agent.tool
    def read_skill(ctx: RunContext[str]) -> str:
        """Read the expense policy from the real Skiva Linux FUSE mount."""
        return docker('cat', f'/mnt/{ctx.deps}/{name}/SKILL.md')

    def promote(snapshot, rollback=False):
        channel = next(c for c in api('/channels')['items'] if c['name'] == 'canary')
        api('/channels/' + channel['id'] + ('/rollback' if rollback else '/promote'), {'snapshotId': snapshot, 'expectedGeneration': channel['generation'], 'reason': 'Local Pydantic AI acceptance'})
        return channel['id']

    def refresh(mode):
        docker(MOUNT, 'refresh', '--cache', '/tmp/cache-' + mode)

    def evaluate(label, mode, version, approved):
        result = agent.run_sync('A valid receipt claims 150 yuan. Should it be approved?', deps=mode, usage_limits=UsageLimits(request_limit=5))
        assert result.usage.tool_calls >= 1, "Agent must read the mounted Skill"
        output = result.output
        assert output.policy_version == version and output.approved == approved, output
        assert output.limit_yuan == (100 if version == 'v1' else 200), output
        record = {'case': label, 'mode': mode, 'decision': output.model_dump(), 'usage': str(result.usage)}
        records.append(record)
        (OUT / 'results.json').write_text(json.dumps(records, ensure_ascii=False, indent=2))
        print(json.dumps(record, ensure_ascii=False), flush=True)

    pat = api('/git-tokens', {'name': name, 'repositoryId': repo['id'], 'scopes': ['repo:read', 'repo:write'], 'expiresAt': (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1)).isoformat()})
    env = os.environ.copy()
    env.update(GIT_TERMINAL_PROMPT='0', GIT_CONFIG_COUNT='2', GIT_CONFIG_KEY_0='http.extraHeader', GIT_CONFIG_VALUE_0='Authorization: Basic ' + base64.b64encode(('pilot:' + pat['token']).encode()).decode(), GIT_CONFIG_KEY_1='credential.helper', GIT_CONFIG_VALUE_1='')
    try:
        with tempfile.TemporaryDirectory() as temp:
            work = Path(temp) / 'repo'
            def git(*args):
                return command('git', '-C', str(work), *args, env=env)
            command('git', 'clone', BASE + '/git/agent-pilot/' + name + '.git', str(work), env=env)
            git('config', 'user.name', 'Skiva Agent Pilot'); git('config', 'user.email', 'pilot@localhost')
            def release(version, limit):
                (work / 'SKILL.md').write_text(f'---\nname: {name}\ndescription: Approve synthetic expense claims using a versioned limit.\n---\n\n# Expense policy\nPolicy version: {version}\nLimit: {limit} yuan.\nApprove claims with valid receipts if amount <= {limit} yuan; otherwise reject.\n')
                git('add', 'SKILL.md'); git('commit', '-m', 'Set expense policy ' + version); git('push', 'origin', 'HEAD')
                sha = git('rev-parse', 'HEAD')
                def completed():
                    run = next((r for r in api('/pipelines?repoId=' + repo['id'])['items'] if r['commitSha'] == sha), None)
                    if run and run['status'] == 'failed':
                        raise RuntimeError('Pipeline failed: ' + run['id'])
                    return run if run and run['status'] == 'succeeded' else None
                wait_for(completed)
                skill = next(s for s in api('/skills')['items'] if s['repositoryId'] == repo['id'])
                ver = next(v for v in api('/skills/' + skill['id'] + '/versions')['items'] if v['commitSha'] == sha)
                return api('/releases', {'versionIds': [ver['id']], 'acknowledgeWarnings': True})['id']
            first = release('v1', 100)
            channel = promote(first)
            for mode in ('dynamic', 'pinned'):
                profile = api('/agent-profiles', {'name': name + '-' + mode, 'channelId': channel, 'consistencyMode': mode, 'offlinePolicy': 'deny_on_disconnect', 'enabled': True, 'skills': [name], **({'pinnedSnapshotId': first} if mode == 'pinned' else {})})
                client = api('/mount-clients', {'name': name + '-' + mode, 'profileId': profile['id']})
                clients.append(client)
                token_file = OUT / (mode + '.token')
                token_file.touch(mode=0o600); token_file.chmod(0o600); token_file.write_text(client['token'])
                # Each run replaces only this pilot's mounts.
                subprocess.run(['docker', 'exec', CONTAINER, MOUNT, 'unmount', '--cache', '/tmp/cache-' + mode], capture_output=True)
                command('docker', 'exec', '-d', CONTAINER, MOUNT, 'mount', '--server', 'http://127.0.0.1:8080', '--profile', profile['id'], '--mode', mode, '--token-file', '/pilot/' + mode + '.token', '--path', '/mnt/' + mode, '--cache', '/tmp/cache-' + mode)
                wait_for(lambda: subprocess.run(['docker', 'exec', CONTAINER, 'test', '-f', '/mnt/' + mode + '/' + name + '/SKILL.md'], capture_output=True).returncode == 0)
            evaluate('initial', 'dynamic', 'v1', False)
            second = release('v2', 200); promote(second)
            refresh('dynamic'); refresh('pinned')
            evaluate('updated', 'dynamic', 'v2', True)
            evaluate('pinned_after_update', 'pinned', 'v1', False)
            promote(first, rollback=True); refresh('dynamic')
            evaluate('rollback', 'dynamic', 'v1', False)
            for client in clients:
                api('/mount-clients/' + client['id'] + '/revoke', {})
            for mode in ('dynamic', 'pinned'):
                subprocess.run(['docker', 'exec', CONTAINER, MOUNT, 'refresh', '--cache', '/tmp/cache-' + mode], capture_output=True)
                denied = subprocess.run(['docker', 'exec', CONTAINER, 'cat', '/mnt/' + mode + '/' + name + '/SKILL.md'], capture_output=True).returncode != 0
                assert denied, 'Revoked credentials still allow reads'
            records.append({'case': 'revocation', 'dynamic_denied': True, 'pinned_denied': True})
            (OUT / 'results.json').write_text(json.dumps(records, ensure_ascii=False, indent=2))
            print('PASS: native Git, pipelines, releases, real FUSE, real model, update, pin, rollback, revoke', flush=True)
    finally:
        api('/git-tokens/' + pat['id'] + '/revoke', {})
        for client in clients:
            api('/mount-clients/' + client['id'] + '/revoke', {})
        tracer.shutdown(); trace_file.close()
        for mode in ('dynamic', 'pinned'):
            (OUT / (mode + '.token')).unlink(missing_ok=True)

if __name__ == '__main__':
    main()
