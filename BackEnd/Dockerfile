FROM --platform=$BUILDPLATFORM node:20-alpine AS deps
WORKDIR /app
COPY BackEnd/package*.json ./
RUN npm ci

FROM --platform=$BUILDPLATFORM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY BackEnd/ .
RUN npm run build

FROM --platform=$TARGETPLATFORM node:20-alpine AS runtime
WORKDIR /app
ARG APP_VERSION=dev
ENV NODE_ENV=production
ENV APP_VERSION=$APP_VERSION
COPY BackEnd/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3001
CMD ["node", "dist/index.js"]
