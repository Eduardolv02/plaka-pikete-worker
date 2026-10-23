# Render B Docker runtime: Python/yt-dlp + FFmpeg on the server, never Android.
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /app/.venv && /app/.venv/bin/pip install --no-cache-dir 'yt-dlp>=2025.01.01'
ENV PATH="/app/.venv/bin:${PATH}" \
    NODE_ENV=production \
    PORT=10000
WORKDIR /app
COPY package.json ./
COPY . ./
USER node
EXPOSE 10000
CMD ["node", "server.mjs"]
