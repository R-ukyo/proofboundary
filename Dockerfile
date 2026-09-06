FROM node:20-slim
WORKDIR /work
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["node", "dist/src/tcb/runtime/main.js"]
