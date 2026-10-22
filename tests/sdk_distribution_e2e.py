"""Executed by Go's TestPythonSDKDistribution against its actual HTTP server/Postgres."""
import asyncio
import json
import os
import uuid

import httpx
from skiva_sdk import AuthorizationDenied, ManifestChanged, SkivaClient


async def main():
    config = json.loads(os.environ["SKIVA_E2E_CONFIG"])
    base = config["server"]
    a, b = config["snapshots"]
    async with httpx.AsyncClient(trust_env=False, base_url=base, headers={"Authorization": "Bearer " + config["admin"]}) as admin:
        async def mutate(path, body, method="POST"):
            r = await admin.request(method, "/api/v1/" + path, json=body,
                                    headers={"Idempotency-Key": str(uuid.uuid4())})
            r.raise_for_status()
            return r.json()

        async def promote(snapshot, generation, rollback=False):
            await mutate("channels/" + config["channel"] + ("/rollback" if rollback else "/promote"),
                         {"snapshotId": snapshot, "expectedGeneration": generation, "reason": "SDK integration"})

        await promote(a, 0)
        async with SkivaClient(base, config["token"], refresh_interval=0, consistency="dynamic") as client:
            async with client.bind() as live:
                first = await live.catalog()
                assert first.ref.snapshot_id == a
                async with client.snapshot(source=first.ref) as fixed:
                    await promote(b, 1)
                    assert (await live.catalog()).ref.snapshot_id == b
                    assert "Version A" in await fixed.read_text("sample/SKILL.md")
                    # Live activity is recorded even without a mount heartbeat.
                    r = await admin.get("/api/v1/mount-clients/" + config["client"])
                    r.raise_for_status()
                    assert r.json()["status"] == "online", r.text
                    await promote(a, 2, rollback=True)
                    assert (await live.catalog()).ref.snapshot_id == a
                    await mutate("agent-profiles/" + config["profile"], {"skills": []}, "PATCH")
                    try:
                        await fixed.catalog()
                    except ManifestChanged:
                        pass
                    else:
                        raise AssertionError("Old authorized view survived permission removal")
                await mutate("agent-profiles/" + config["profile"], {"skills": ["sample"]}, "PATCH")
                rotated = await mutate("mount-clients/" + config["client"] + "/rotate", {})
                try:
                    await live.catalog()
                except AuthorizationDenied:
                    pass
                else:
                    raise AssertionError("Old credential survived rotation")
        async with SkivaClient(base, rotated["token"]) as fresh:
            async with fresh.snapshot(source=first.ref) as retry:
                assert "Version A" in await retry.read_text("sample/SKILL.md")
                await mutate("mount-clients/" + config["client"] + "/revoke", {})
                try:
                    await retry.catalog()
                except AuthorizationDenied:
                    pass
                else:
                    raise AssertionError("Revoked credential remained usable")
    print("Real SDK/server: publish, update, rollback, fixed retry, permissions, activity, rotation, revoke passed")


if __name__ == "__main__":
    asyncio.run(main())
