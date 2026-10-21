FROM golang:1.26.10 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY apps/server apps/server
COPY packages/protocol packages/protocol
RUN CGO_ENABLED=0 go build -o /server ./apps/server/cmd/server
RUN CGO_ENABLED=0 go build -o /maintenance ./apps/server/cmd/maintenance
RUN CGO_ENABLED=0 go install -tags=no_clickhouse,no_libsql,no_mssql,no_mysql,no_sqlite3,no_vertica,no_ydb github.com/pressly/goose/v3/cmd/goose@v3.24.1
FROM debian:bookworm-slim
ARG GIT_DEBIAN_VERSION=1:2.39.5-0+deb12u3
RUN apt-get update && apt-get install -y --no-install-recommends git=${GIT_DEBIAN_VERSION} openssh-client ca-certificates && rm -rf /var/lib/apt/lists/* && useradd -u 10001 -m skiva && mkdir /data && chown skiva /data
COPY --from=build /server /usr/local/bin/skiva-server
COPY --from=build /maintenance /usr/local/bin/skiva-maintenance
COPY --from=build /go/bin/goose /usr/local/bin/goose
COPY migrations /migrations
COPY LICENSE NOTICE LICENSE-FAQ.md LICENSE-FAQ.zh-CN.md THIRD_PARTY_NOTICES.md THIRD_PARTY_NOTICES.zh-CN.md /usr/share/licenses/skiva/
USER 10001
WORKDIR /data
EXPOSE 8080
ENTRYPOINT ["skiva-server"]
