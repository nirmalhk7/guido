FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN --mount=type=secret,id=guido_build_ca \
    if [ -s /run/secrets/guido_build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/guido_build_ca; fi \
    && npm ci && npm --prefix frontend ci
COPY . .
RUN npm --prefix frontend run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --chown=node:node package.json package-lock.json ./
RUN --mount=type=secret,id=guido_build_ca \
    if [ -s /run/secrets/guido_build_ca ]; then \
      export NODE_EXTRA_CA_CERTS=/run/secrets/guido_build_ca APT_CONFIG=/tmp/guido-build-apt.conf; \
      cp /run/secrets/guido_build_ca /tmp/guido-build-ca.crt; \
      chmod 0644 /tmp/guido-build-ca.crt; \
      if [ -r /etc/ssl/certs/ca-certificates.crt ]; then cat /etc/ssl/certs/ca-certificates.crt >> /tmp/guido-build-ca.crt; fi; \
      printf 'Acquire::https::CAInfo "/tmp/guido-build-ca.crt";\n' > "$APT_CONFIG"; \
      sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources; \
    fi \
    && npm ci --omit=dev \
    && npx playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/* /tmp/guido-build-apt.conf /tmp/guido-build-ca.crt
COPY --chown=node:node lib/rental/ ./lib/rental/
COPY --chown=node:node bin/ ./bin/
COPY --chown=node:node examples/ ./examples/
COPY --from=build --chown=node:node /app/frontend/dist ./frontend/dist
USER node
EXPOSE 3000
CMD ["node", "bin/rental-server.ts"]
