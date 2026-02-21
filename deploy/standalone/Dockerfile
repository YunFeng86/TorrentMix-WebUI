# syntax=docker/dockerfile:1

FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build


FROM caddy:2-alpine

WORKDIR /srv
COPY --from=build /app/dist /srv
COPY deploy/standalone/Caddyfile /etc/caddy/Caddyfile

EXPOSE 8080

