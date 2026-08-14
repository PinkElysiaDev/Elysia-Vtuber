FROM ubuntu:24.04 AS build

RUN apt-get update && apt-get install -y \
    cmake \
    g++ \
    libboost-system-dev \
    libssl-dev \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY . .

RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
RUN cmake --build build --parallel
RUN ctest --test-dir build --output-on-failure

FROM ubuntu:24.04

RUN apt-get update && apt-get install -y \
    libboost-system1.83.0 \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /src/build/vtuber_backend /usr/local/bin/vtuber_backend
COPY --from=build /src/config /app/config

EXPOSE 19264 19265
ENTRYPOINT ["vtuber_backend", "--config", "config/backend.example.json"]
