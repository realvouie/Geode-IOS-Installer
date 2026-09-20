FROM node:22-bookworm AS build-zsign

RUN apt-get update && apt-get install -y --no-install-recommends \
    git build-essential pkg-config libssl-dev libminizip-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --depth 1 https://github.com/zhlynn/zsign.git
WORKDIR /src/zsign/build/linux
RUN make clean && make

FROM node:22-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
COPY --from=build-zsign /src/zsign/bin/zsign /usr/local/bin/zsign

ENV PORT=3000
EXPOSE 3000
CMD ["node","server.js"]
