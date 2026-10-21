FROM node:24-bookworm-slim AS build
WORKDIR /src/apps/web
COPY apps/web/package*.json ./
RUN npm ci
COPY apps/web ./
COPY packages/openapi /src/packages/openapi
ARG SKIVA_API_URL=http://server:8080
ENV SKIVA_API_URL=$SKIVA_API_URL
RUN npm run build
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /src/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /src/apps/web/.next/static ./apps/web/.next/static
COPY LICENSE NOTICE LICENSE-FAQ.md THIRD_PARTY_NOTICES.md /usr/share/licenses/skiva/
USER node
EXPOSE 3000
CMD ["node","apps/web/server.js"]
