FROM node:20-alpine

WORKDIR /app

# better-sqlite3 necesita compilar código nativo
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=3000
ENV DB_PATH=/app/data/gastos.db

EXPOSE 3000

CMD ["node", "server.js"]
