# https://registry-1.docker.io/v2/oven/bun/manifests/1.4
FROM oven/bun:1.4@sha256:ec06c3b6cea04192ae6770c434f668ca41d343ad19fa6472216c7b48be39c598 AS build
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=$GIT_COMMIT
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# https://registry-1.docker.io/v2/oven/bun/manifests/1.4
FROM oven/bun:1.4@sha256:ec06c3b6cea04192ae6770c434f668ca41d343ad19fa6472216c7b48be39c598
WORKDIR /app
COPY container/serve.ts ./
COPY --from=build /app/dist ./dist
USER bun
EXPOSE 8080
CMD ["bun", "serve.ts"]
