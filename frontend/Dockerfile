FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY apps/customer/package.json ./apps/customer/package.json
COPY apps/admin/package.json ./apps/admin/package.json
COPY packages/ui/package.json ./packages/ui/package.json
RUN npm ci
COPY . .
ARG APP=customer
ARG NEXT_PUBLIC_API_URL=http://localhost:3121
ARG NEXT_PUBLIC_CUSTOMER_ORIGIN=http://localhost:3120
ARG NEXT_PUBLIC_ADMIN_ORIGIN=http://localhost:3123
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_CUSTOMER_ORIGIN=$NEXT_PUBLIC_CUSTOMER_ORIGIN NEXT_PUBLIC_ADMIN_ORIGIN=$NEXT_PUBLIC_ADMIN_ORIGIN
RUN npm run build --workspace @m8itwork/$APP
FROM node:22-bookworm-slim
ARG APP=customer
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3120
COPY --from=build --chown=node:node /app/apps/${APP}/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/${APP}/.next/static ./apps/${APP}/.next/static
COPY --from=build --chown=node:node /app/apps/${APP}/public ./apps/${APP}/public
RUN ln -s apps/${APP}/server.js server.js
USER node
EXPOSE 3120
CMD ["node", "server.js"]
