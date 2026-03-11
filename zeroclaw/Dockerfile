# ---- 1. ソース取得 ----
FROM rust:1.94-bookworm AS source
WORKDIR /build
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
ARG ZEROCLAW_REF=v0.1.7
RUN git clone --depth 1 --branch ${ZEROCLAW_REF} \
    https://github.com/zeroclaw-labs/zeroclaw.git .

# ---- 2. cargo-chef: 依存クレートのレシピ作成 ----
FROM rust:1.94-bookworm AS chef
RUN cargo install cargo-chef --locked
WORKDIR /build

FROM chef AS planner
COPY --from=source /build .
RUN cargo chef prepare --recipe-path recipe.json

# ---- 3. 依存クレートのビルド (キャッシュ対象) ----
FROM chef AS deps
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY --from=planner /build/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json

# ---- 4. アプリ本体のビルド ----
FROM deps AS build
COPY --from=source /build .
RUN cargo build --release --locked

# ---- 5. ランタイム ----
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /build/target/release/zeroclaw /usr/local/bin/zeroclaw
RUN useradd -m zeroclaw
USER zeroclaw
WORKDIR /home/zeroclaw
EXPOSE 42617
CMD ["zeroclaw", "gateway", "--port", "42617", "--bind", "0.0.0.0"]
