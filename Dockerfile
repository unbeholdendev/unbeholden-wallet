FROM oven/bun:1.4 AS build
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=$GIT_COMMIT
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM nginx:1.29-alpine
COPY container/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
