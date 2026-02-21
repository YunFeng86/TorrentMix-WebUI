# syntax=docker/dockerfile:1

FROM node:20-alpine

RUN apk add --no-cache unzip

WORKDIR /app
COPY deploy/sidecar/updater.mjs /app/updater.mjs

ENV TARGET_DIR=/target
ENV CHECK_INTERVAL_SEC=3600

ENTRYPOINT ["node", "/app/updater.mjs"]

