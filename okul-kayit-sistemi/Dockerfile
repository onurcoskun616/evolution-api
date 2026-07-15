FROM node:22-alpine

# better-sqlite3 derlemesi için araçlar (prebuilt yoksa)
RUN apk add --no-cache python3 make g++

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && apk del python3 make g++

COPY server.js setup.js seed.js ./
COPY src ./src
COPY public ./public

# Veritabanı kalıcı dizini
ENV OKUL_DATA_DIR=/data
VOLUME /data

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

# İlk açılışta (boş veritabanında) üretim kurulumunu çalıştırır, sonra sunucuyu başlatır
CMD ["sh", "-c", "node setup.js && node server.js"]
