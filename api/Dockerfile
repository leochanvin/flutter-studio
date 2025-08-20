FROM node:20-alpine
WORKDIR /app

# Copie les manifestes (prend package.json ET package-lock.json s'il existe)
COPY package*.json ./

# Installe les deps de prod (utilise le lockfile s'il est présent, sinon résout tout seul)
RUN npm install --omit=dev

# Copie le reste du code
COPY . .

ENV PORT=8080
EXPOSE 8080
CMD ["npm","start"]