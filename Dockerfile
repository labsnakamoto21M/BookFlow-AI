FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (dev + prod for build)
RUN npm ci

# Copy source code
COPY . .

# Build during Docker build phase
RUN npm run build

# Expose port
EXPOSE 5000

# Start the already-built server
CMD ["node", "dist/index.cjs"]