# ---- ビルド済みバイナリを GitHub Releases から取得 ----
FROM debian:trixie-slim

ARG ZEROCLAW_VERSION=v0.1.7
ARG TARGETARCH=amd64

RUN apt-get update && apt-get install -y ca-certificates curl && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL \
       "https://github.com/zeroclaw-labs/zeroclaw/releases/download/${ZEROCLAW_VERSION}/zeroclaw-x86_64-unknown-linux-gnu.tar.gz" \
       -o /tmp/zeroclaw.tar.gz \
    && tar -xzf /tmp/zeroclaw.tar.gz -C /usr/local/bin/ \
    && rm /tmp/zeroclaw.tar.gz \
    && chmod +x /usr/local/bin/zeroclaw

RUN useradd -m zeroclaw \
    && mkdir -p /workspace \
    && chown zeroclaw:zeroclaw /workspace
USER zeroclaw
WORKDIR /home/zeroclaw
EXPOSE 42617
CMD ["zeroclaw", "gateway", "--port", "42617"]
