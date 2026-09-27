# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
#  DC Hospital — production image (Coolify / any Docker host)
#  Stage 1 builds the Vite app, stage 2 serves it with nginx (≈ 25 MB image).
#  Supabase keys are read at CONTAINER START (no rebuild needed to change them).
# ─────────────────────────────────────────────────────────────────────────────

# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# Optional: bake values in at build time (runtime env vars still override them).
ARG VITE_SUPABASE_URL=""
ARG VITE_SUPABASE_ANON_KEY=""
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

RUN npm run build

# ---------- runtime ----------
FROM nginx:1.27-alpine AS runtime

LABEL org.opencontainers.image.title="DC Hospital Management System" \
      org.opencontainers.image.description="React + Supabase hospital management system" \
      org.opencontainers.image.source="https://github.com/Avinashtosoni/DC-hospital"

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/40-runtime-env.sh /docker-entrypoint.d/40-runtime-env.sh
COPY --from=build /app/dist /usr/share/nginx/html

RUN chmod +x /docker-entrypoint.d/40-runtime-env.sh \
 && chown -R nginx:nginx /usr/share/nginx/html

ENV VITE_SUPABASE_URL="" \
    VITE_SUPABASE_ANON_KEY=""

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1

# nginx's stock entrypoint runs /docker-entrypoint.d/*.sh, then starts nginx
CMD ["nginx", "-g", "daemon off;"]
