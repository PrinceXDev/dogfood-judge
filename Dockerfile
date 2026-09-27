# Two stages: build a static binary (pure-Go SQLite, no cgo), then run it on
# a small base with nothing else in it.
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY src ./src
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/dogfood ./src/cmd/dogfood

FROM alpine:3.22
RUN adduser -D -u 10001 dogfood && mkdir -p /data && chown dogfood /data
COPY --from=build /out/dogfood /usr/local/bin/dogfood
COPY fixtures.json /app/fixtures.json
WORKDIR /app
USER dogfood
ENV DOGFOOD_ADDR=:8080 \
    DOGFOOD_DB=/data/dogfood.db \
    DOGFOOD_FIXTURES=/app/fixtures.json \
    DOGFOOD_DEMO=1
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["dogfood"]
CMD ["serve"]
