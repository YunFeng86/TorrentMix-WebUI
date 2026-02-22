# syntax=docker/dockerfile:1

FROM node:20-alpine AS build-ui
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build


FROM rust:1.78-alpine AS build-server
WORKDIR /src/rust

RUN apk add --no-cache musl-dev

COPY rust/Cargo.toml rust/Cargo.lock ./
COPY rust/apps ./apps
COPY rust/crates ./crates

RUN cargo build --locked --release -p standalone-service


FROM alpine:3.20
RUN apk add --no-cache ca-certificates

WORKDIR /app
COPY --from=build-ui /app/dist /app/dist
COPY --from=build-server /src/rust/target/release/standalone-service /app/standalone-service

ENV LISTEN_ADDR=:8080
ENV STATIC_DIR=/app/dist
ENV STANDALONE_CONFIG=/config/standalone.json

EXPOSE 8080
ENTRYPOINT ["/app/standalone-service"]
