-- name: DatabaseTime :one
SELECT now()::timestamptz;

-- name: ClaimJob :one
UPDATE job_queue SET status='running',attempts=attempts+1,leased_until=now()+interval '5 minutes'
WHERE id=(SELECT id FROM job_queue WHERE (status='queued' AND run_after<=now()) OR (status='running' AND leased_until<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
RETURNING id,payload;
