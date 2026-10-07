FROM node:22-bookworm-slim AS build
WORKDIR /build/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --ignore-scripts
COPY backend/tsconfig.json ./
COPY backend/src/worker ./src/worker
COPY backend/src/reviews/types.ts ./src/reviews/types.ts
COPY backend/src/reviews/redaction.ts ./src/reviews/redaction.ts
COPY backend/src/crypto.ts ./src/crypto.ts
COPY worker/tsconfig.json /build/worker/tsconfig.json
RUN ./node_modules/.bin/tsc -p /build/worker/tsconfig.json

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl util-linux git \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY worker/package.json worker/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /build/worker/dist ./dist
COPY worker/entrypoint.sh worker/run-worker.sh worker/smoke.mjs ./
RUN chmod 755 /app/entrypoint.sh /app/run-worker.sh \
    && install -d -o node -g node -m 700 /home/node/.m8itwork /home/node/.codex /home/node/.claude \
    && chmod 700 /home/node
ENV HOME=/home/node PATH=/app/node_modules/.bin:/usr/local/bin:/usr/bin:/bin
USER node
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["run"]
