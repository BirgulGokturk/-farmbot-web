# --------------------------------------------------------------------------- #
# Geliştirme: canlı yeniden yükleme (docker-compose bu hedefi kullanır)
# --------------------------------------------------------------------------- #
FROM node:22-alpine AS development

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# --------------------------------------------------------------------------- #
# Derleme
# --------------------------------------------------------------------------- #
FROM node:22-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# API adresi derleme zamanında gömülür
ARG VITE_API_URL
ARG VITE_WS_URL
RUN npm run build

# --------------------------------------------------------------------------- #
# Üretim: statik dosyaları nginx ile servis et
# --------------------------------------------------------------------------- #
FROM nginx:alpine AS production

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
