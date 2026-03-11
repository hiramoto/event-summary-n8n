FROM rust:1.94-bookworm AS build
WORKDIR /build

RUN apt-get update && apt-get install -y git pkg-config libssl-dev ca-certificates && rm -rf /var/lib/apt/lists/*

# main直取りをやめて、安定タグに固定
ARG ZEROCLAW_REF=v0.1.7
RUN git clone https://github.com/zeroclaw-labs/zeroclaw.git . \
    && git checkout ${ZEROCLAW_REF} \
    && cargo build --release --locked

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /build/target/release/zeroclaw /usr/local/bin/zeroclaw
RUN useradd -m zeroclaw
USER zeroclaw
WORKDIR /home/zeroclaw
EXPOSE 42617
CMD ["zeroclaw", "gateway", "--port", "42617", "--bind", "0.0.0.0"]
