# Frontend assets are architecture-independent, so build natively to avoid QEMU crashes in ARM image builds.
FROM --platform=$BUILDPLATFORM node:20-alpine AS build
WORKDIR /app
COPY FrontEnd/package*.json ./
RUN npm ci
COPY FrontEnd/ .
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

FROM --platform=$TARGETPLATFORM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY FrontEnd/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
