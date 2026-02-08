FROM node:24-alpine

# Build args for version info (passed from CI)
ARG GIT_COMMIT=""
ARG GIT_COMMIT_SHORT=""
ARG GIT_BRANCH=""
ARG GIT_TAG=""

# Set as environment variables for runtime
ENV GIT_COMMIT=$GIT_COMMIT
ENV GIT_COMMIT_SHORT=$GIT_COMMIT_SHORT
ENV GIT_BRANCH=$GIT_BRANCH
ENV GIT_TAG=$GIT_TAG

WORKDIR /app

# Install dependencies first (better caching)
COPY package*.json ./
RUN npm install --omit=dev

# Copy source
COPY src ./src

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    mkdir -p /app/data && chown nodejs:nodejs /app/data
USER nodejs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "src/index-http.js"]
