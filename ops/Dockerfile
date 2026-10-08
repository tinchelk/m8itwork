FROM node:22-bookworm-slim AS node
FROM postgres:18-bookworm
COPY --from=node /usr/local/bin/node /usr/local/bin/node
RUN groupadd -g 10001 operations && useradd -u 10001 -g operations -M operations
WORKDIR /app
COPY ops/agent.mjs /app/agent.mjs
COPY backend/scripts/backup.ts /app/backup.ts
# Node 22 strips the standalone tool's TypeScript; omit dotenv so no app env is loaded.
RUN sed -i '/import "dotenv\/config";/d' /app/backup.ts
USER 10001:10001
ENTRYPOINT ["flock", "--nonblock", "--no-fork", "/backups/.operations.lock", "node", "/app/agent.mjs"]
