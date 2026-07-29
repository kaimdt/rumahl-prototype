FROM node:20-alpine
WORKDIR /app
COPY runtime.js /app/runtime.js
RUN mkdir -p /plugins
EXPOSE 8765
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
CMD wget -qO- http://127.0.0.1:8765/health >/dev/null 2>&1 || exit 1
CMD ["node", "/app/runtime.js"]
