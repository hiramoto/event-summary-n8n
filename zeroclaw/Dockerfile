FROM rust:1.82-slim-bookworm AS builder
RUN apt-get update && apt-get install -y pkg-config libssl-dev git && rm -rf /var/lib/apt/lists/*
WORKDIR /build
RUN git clone --depth 1 https://github.com/zeroclaw-labs/zeroclaw.git . \
    && cargo build --release --locked

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build/target/release/zeroclaw /usr/local/bin/zeroclaw
RUN useradd -m zeroclaw
USER zeroclaw
WORKDIR /home/zeroclaw
EXPOSE 42617
CMD ["zeroclaw", "gateway", "--port", "42617", "--bind", "0.0.0.0"]
