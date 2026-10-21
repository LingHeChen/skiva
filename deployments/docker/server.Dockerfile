FROM golang:1.26.10 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY apps/server apps/server
COPY packages/protocol packages/protocol
RUN CGO_ENABLED=0 go build -o /server ./apps/server/cmd/server
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git openssh-client ca-certificates && rm -rf /var/lib/apt/lists/* && useradd -u 10001 -m skiva && mkdir /data && chown skiva /data
COPY --from=build /server /usr/local/bin/skiva-server
USER 10001
WORKDIR /data
EXPOSE 8080
ENTRYPOINT ["skiva-server"]
