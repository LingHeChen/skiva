SHELL := /bin/bash
export GOTOOLCHAIN := go1.26.10
DATABASE_URL ?= $(if $(ESDP_DATABASE_URL),$(ESDP_DATABASE_URL),postgres://esdp:esdp-dev@localhost:55432/esdp?sslmode=disable)
TEST_DATABASE_URL ?= postgres://esdp:esdp-dev@localhost:55432/esdp_test?sslmode=disable
export ESDP_DATABASE_URL := $(DATABASE_URL)
GOOSE := go run github.com/pressly/goose/v3/cmd/goose@v3.24.1
.PHONY: dev deps db migrate-up migrate-down lint test test-e2e openapi-generate sqlc-generate build-server build-mount build backup verify-artifacts

deps:
	go mod download
	npm ci --prefix apps/web

db:
	./scripts/db.sh

migrate-up:
	$(GOOSE) -dir migrations postgres '$(DATABASE_URL)' up

migrate-down:
	$(GOOSE) -dir migrations postgres '$(DATABASE_URL)' down

dev:
	./scripts/dev.sh

lint:
	go vet ./apps/server/... ./apps/mount/... ./packages/...
	npm run lint --prefix apps/web
	npm run typecheck --prefix apps/web

test:
	ESDP_TEST_DATABASE_URL='$(TEST_DATABASE_URL)' go test -race ./apps/server/... ./apps/mount/... ./packages/...

test-e2e:
	cd apps/web && npx playwright test

openapi-generate:
	python3 scripts/generate-openapi.py
	cd apps/web && npx openapi-typescript ../../packages/openapi/openapi.yaml -o ../../packages/openapi/generated.ts

sqlc-generate:
	go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.30.0 generate

build-server:
	go build -trimpath -o bin/esdp-server ./apps/server/cmd/server

build-mount:
	GOOS=linux GOARCH=amd64 go build -trimpath -o bin/skills-mount-linux-amd64 ./apps/mount/cmd/skills-mount
	GOOS=linux GOARCH=arm64 go build -trimpath -o bin/skills-mount-linux-arm64 ./apps/mount/cmd/skills-mount

build: build-server build-mount
	npm run build --prefix apps/web

verify-artifacts:
	go run ./apps/server/cmd/maintenance verify

backup:
	./scripts/backup.sh

validation-deps:
	python3 -m venv .data/validation-venv
	.data/validation-venv/bin/pip install -r scripts/requirements-validation.txt

contract-check:
	.data/validation-venv/bin/python scripts/contract-check.py

test-db: db
	docker exec esdp-postgres psql -U esdp -d esdp_test -c 'SELECT 1' >/dev/null 2>&1 || docker exec esdp-postgres createdb -U esdp esdp_test
	$(MAKE) DATABASE_URL='$(TEST_DATABASE_URL)' migrate-up
