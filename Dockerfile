# ── Build stage: compile React client ──────────────────────
FROM node:20-slim AS client-build

WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./

# Firebase client config (baked into React build)
ARG REACT_APP_FIREBASE_API_KEY
ARG REACT_APP_FIREBASE_AUTH_DOMAIN
ARG REACT_APP_FIREBASE_PROJECT_ID
ARG REACT_APP_API_URL

RUN npm run build

# ── Production stage ───────────────────────────────────────
FROM node:20-slim

WORKDIR /app

# Install server dependencies
COPY server/package*.json ./server/
RUN cd server && npm ci --production

# Copy server source
COPY server/ ./server/

# Copy built client
COPY --from=client-build /app/client/build ./client/build

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server/server.js"]
