t# Scheduler Dockerfile - VM Deployment
# Lightweight Node.js container for running the scheduler API

FROM node:20-alpine

# Install podman (if using local container adapter)
RUN apk add --no-cache \
    podman \
    fuse-overlayfs \
    shadow-uidmap \
    ca-certificates \
    curl

# Configure podman for rootless mode
RUN mkdir -p /etc/containers && \
    echo "[storage]" > /etc/containers/storage.conf && \
    echo "driver = \"overlay\"" >> /etc/containers/storage.conf && \
    echo "graphroot = \"/var/lib/containers/storage\"" >> /etc/containers/storage.conf && \
    echo "[storage.options.overlay]" >> /etc/containers/storage.conf && \
    echo "mount_program = \"/usr/bin/fuse-overlayfs\"" >> /etc/containers/storage.conf

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install --production

# Copy built application
COPY dist ./dist

# Expose port
EXPOSE 3000

# Environment variables
ENV PORT=3000
ENV HOST=0.0.0.0
ENV CONTAINER_ADAPTER=podman
ENV CONTAINER_IMAGE=skyfernaic01.azurecr.io/meet-teams-bot:latest
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Start server
CMD ["node", "dist/server.js"]
