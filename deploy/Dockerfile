# SHANTAZ ERP — self-host / any-host image for the frontend (static Vite build + nginx).
# Build from the repo root:
#   docker build -f deploy/Dockerfile \
#     --build-arg VITE_SUPABASE_URL=https://<ref>.supabase.co \
#     --build-arg VITE_SUPABASE_ANON_KEY=<anon/publishable key — typed by the owner> \
#     --build-arg VITE_ENABLED_MODULES=machines,reports,settings,users,roles \
#     -t shantaz-erp .
#   docker run -d -p 8080:80 --restart unless-stopped shantaz-erp
# Vite bakes VITE_* values into the JS at build time: change one => rebuild the image.
# The anon/publishable key is public by design (it ships to every browser); never pass
# the service-role key here.

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_SUPABASE_URL=""
ARG VITE_SUPABASE_ANON_KEY=""
ARG VITE_USE_SUPABASE="true"
ARG VITE_APP_ENV="production"
ARG VITE_APP_NAME="SHANTAZ ERP"
ARG VITE_ALLOW_DEMO="false"
ARG VITE_ENABLED_MODULES=""
ARG VITE_ERP_INSTANCE=""
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_USE_SUPABASE=$VITE_USE_SUPABASE VITE_APP_ENV=$VITE_APP_ENV VITE_APP_NAME=$VITE_APP_NAME \
    VITE_ALLOW_DEMO=$VITE_ALLOW_DEMO VITE_ENABLED_MODULES=$VITE_ENABLED_MODULES \
    VITE_ERP_INSTANCE=$VITE_ERP_INSTANCE
RUN npm run build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
