# Personal Event Pipeline — n8n + OpenClaw on Sakura VPS

スマホ（Android / Tasker）から送信した個人イベントデータ（位置情報など）を収集・集約し、exe.dev 上の OpenClaw に圧縮して渡すことで、タイミングに応じたパーソナルなメッセージを受け取るためのシステム。

## 実装優先順位（MVP）

現状は **Fastify + Prisma の Event/Digest API まで実装済み**。残りを以下の順で進める。

1. **Phase 1（API/DB 基盤）**: 実装済み
   - `POST /events`, `GET /events`
   - `POST /digests`, `GET /digests`, `POST /digests/:digestId/sent`
   - Prisma 経由での永続化（`events` / `digests`）
2. **Phase 2（OpenClaw 連携の運用強化）**: 未実装
   - n8n から OpenClaw 送信、再送ポリシーの明文化
3. **Phase 3（イベントタイプ拡張）**: 未実装
   - `email` / `todo` / `vital` の受信・集約仕様を追加

### ローカル実行（TypeScript）

```bash
cp .env.example .env
npm install
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

### Docker Compose での起動

`docker-compose.yml` を同梱しているため、ローカルでも API + PostgreSQL + n8n をそのまま起動できます。

```bash
cp .env.example .env
docker compose up --build -d
```

初回起動時は API コンテナ内で `prisma migrate deploy` が実行され、DB スキーマが自動適用されます。
また PostgreSQL 初期化時に `n8ndb` が自動作成され、n8n が同じ PostgreSQL を利用します。

起動確認:

```bash
curl -i http://localhost:3000/healthz
curl -I http://localhost:5678
```

`5678` は `127.0.0.1` バインドなので、n8n UI へは同一ホストからのみアクセスできます。

### Rocky Linux サーバーでの n8n 確認手順

Rocky Linux 上では、以下の順で「起動」「UI疎通」「ログイン可否」を確認できます。

1. コンテナ状態の確認

```bash
docker compose ps
```

期待値: `event-summary-n8n` が `Up`（または `healthy`）になっている。

2. n8n のログ確認（起動失敗時の一次切り分け）

```bash
docker compose logs n8n --tail=100
```

期待値: `Editor is now accessible` 相当のログが出る。

3. サーバー内から UI へ HTTP 到達確認

```bash
curl -I http://127.0.0.1:5678
```

期待値: `HTTP/1.1 200 OK`（またはログインページへの `302`）。

4. 手元PCから SSH トンネルで UI を開く

```bash
ssh -L 5678:127.0.0.1:5678 <user>@<rocky-server>
```

その後、ローカルブラウザで `http://127.0.0.1:5678` を開いて UI 設定を行う。

> 補足: `ports` を `127.0.0.1:5678:5678` にしているため、外部ネットワークから n8n UI へ直接アクセスできません（公開しない方針を維持）。

停止:

```bash
docker compose down
```

### スクリプト導線

```bash
npm run test      # node:test + tsx で API テスト実行
npm run typecheck # TypeScript 型チェック
npm run check     # test + typecheck
npm run build     # check 通過後に dist へビルド
npm run start     # dist/server.js を起動
```

### 受信確認（最短チェック）

公開前に「イベントが投稿できているか」だけ先に確認したい場合は、以下の3ステップで確認できます。

1. API 生存確認

```bash
curl -i https://<your-domain>/healthz
```

期待値: `200` と `{"ok":true}`

2. テストイベントを 1 件 POST

```bash
curl -i -X POST https://<your-domain>/events \
  -H "Authorization: Bearer <EVENT_API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "event_id":"550e8400-e29b-41d4-a716-446655440111",
    "type":"location",
    "ts":"2026-03-03T09:00:00+09:00",
    "payload":{"event":"enter","place_id":"office"},
    "device_id":"android-main",
    "meta":{"source":"manual-check"}
  }'
```

期待値: `200` と `{"ok":true, "duplicate":false}`

3. 受信済みイベントを GET

```bash
curl -i "https://<your-domain>/events?limit=5" \
  -H "Authorization: Bearer <EVENT_API_TOKEN>"
```

期待値: 直前に送った `event_id` がレスポンスに含まれる

### さくらの Docker コンテナサービス向け最小デプロイ

このリポジトリには `Dockerfile` と `.env.example` を同梱しているため、
コンテナサービスにそのまま登録できます。

1. `main` ブランチ（またはデプロイ対象ブランチ）を push
2. サービス側で以下の環境変数を設定
   - `PORT`（例: `3000`）
   - `EVENT_API_TOKEN`
   - `DATABASE_URL`（PostgreSQL の接続文字列）
3. 公開ポートを `3000` に設定
4. デプロイ実行

> コンテナ起動時に `prisma migrate deploy` を自動実行してから API を起動します。
> そのため、`DATABASE_URL` は起動時点で接続可能な DB を指定してください。

## 全体構成

```
┌──────────────┐
│  Android     │  Tasker + AutoLocation
│  (スマホ)    │  ジオフェンス enter/exit/dwell
└──────┬───────┘
       │  POST /events (Bearer Token)
       │  via Cloudflare (orange cloud ON)
       ▼
┌──────────────────────────────────────────────────────┐
│  Sakura VPS (Docker Compose)                         │
│                                                      │
│  ┌──────────┐    ┌──────────┐    ┌────────────────┐ │
│  │  Caddy   │───▶│ Event API│───▶│   PostgreSQL   │ │
│  │ (TLS:    │    │ (公開)   │    │ eventdb / n8ndb│ │
│  │  Origin  │    └──────────┘    └───────┬────────┘ │
│  │  Cert)   │                            │          │
│  └──────────┘                    ┌───────┴────────┐ │
│                                  │      n8n       │ │
│       Caddy は Event API のみ    │ (内部のみ)     │ │
│       n8n は外部に公開しない      │ 管理: SSH tunnel│ │
│                                  └───────┬────────┘ │
│                                          │          │
└──────────────────────────────────────────┼──────────┘
                                           │
                     n8n: cron(5分) → バッチ集計 → digest 生成
                                           │
                                           ▼
                                 ┌───────────────────┐
                                 │    OpenClaw        │
                                 │   (exe.dev)        │
                                 │  POST /hooks/agent │
                                 │  Bearer Token 認証  │
                                 └───────────────────┘
```

## 確定方針

開発を始める前に決め切った事項。これらは変更しない限り全体の前提となる。

### TLS 方針

**Cloudflare プロキシ ON（オレンジ雲）+ Origin Certificate + Full (Strict) + Authenticated Origin Pulls**

- Cloudflare が外向き TLS を終端し、CDN / WAF / Rate Limiting を提供
- Caddy は Cloudflare Origin Certificate でオリジン側 TLS を提供（最長15年有効、Let's Encrypt 不要）
- Authenticated Origin Pulls により Cloudflare 経由以外のアクセスを TLS レベルで拒否
- さくら VPS のパケットフィルタで 80/443 を Cloudflare IP のみに制限

### n8n の公開方針

**n8n は外部に公開しない。入口は Event API のみ。**

- n8n の管理 UI は SSH トンネル経由でのみアクセス（`ssh -L 5678:localhost:5678 vps`）
- n8n に `WEBHOOK_URL` は設定しない（外部から n8n webhook を叩かない）
- n8n は DB をポーリングして未処理イベントを取得する（cron トリガー → DB クエリ）
- OpenClaw への送信は n8n から HTTP Request ノードで行う（アウトバウンドのみ）

### 状態管理（未処理の定義）

**`events.processed_at` で管理する。**

- `events.processed_at TIMESTAMPTZ NULL` — 初期値 NULL = 未処理
- n8n バッチは `WHERE processed_at IS NULL` を対象に集計
- digest 生成成功後に対象イベントの `processed_at` を現在時刻で UPDATE
- OpenClaw 送信成功時に `digests.sent_at` を更新
- 送信失敗時は `sent_at` を NULL のまま残し、次回バッチで再送

### 冪等性（重複排除）

**envelope に `event_id`（UUID）を必須化し、DB で UNIQUE 制約。**

- スマホの再送・二重送信を DB レベルで吸収
- Event API は `INSERT ... ON CONFLICT (event_id) DO NOTHING` で 200 を返す

### マイグレーション

**Prisma Migrate でスキーマ管理。**

- `docker-entrypoint-initdb.d` は DB 作成のみ（`CREATE DATABASE eventdb` / `CREATE DATABASE n8ndb`）
- テーブル定義は `prisma/schema.prisma` で管理し `prisma migrate deploy` で適用
- 開発中のスキーマ変更も migration ファイルで追跡

## コンセプト

- **入口は Event API だけ**を公開し、n8n は内部に閉じる
- **DB（SoR）に必ず保存してから**処理する（イベントは消えない）
- **envelope 固定設計**: `POST /events` のエンドポイントは変えず、`type` / `payload` を増やすだけで拡張可能
- **圧縮してから OpenClaw へ**: 生データは溜め、状態変化と短い要約だけを外部へ送る
- **5分以内の応答**: イベント発生から OpenClaw のメッセージ受信まで最大5分（cron 間隔）

## イベント設計

### 共通エンベロープ

```json
{
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "location",
  "ts": "2025-02-23T10:30:00+09:00",
  "payload": { ... },
  "device_id": "android-main",
  "meta": {}
}
```

| フィールド | 型 | 必須 | 説明 |
|-----------|------|------|------|
| `event_id` | UUID | Yes | クライアント生成。重複排除キー |
| `type` | string | Yes | イベント種別（`location`, `email`, `todo`, `vital`） |
| `ts` | ISO 8601 | Yes | イベント発生時刻（タイムゾーン付き） |
| `payload` | object | Yes | type ごとの詳細データ |
| `device_id` | string | No | 送信元デバイス識別子 |
| `meta` | object | No | 拡張用メタデータ |

### Phase 1: location（初期リリース）

```json
{
  "event_id": "...",
  "type": "location",
  "ts": "2025-02-23T10:30:00+09:00",
  "payload": {
    "event": "enter",
    "place_id": "office",
    "lat": 34.855,
    "lng": 136.381,
    "accuracy_m": 15
  },
  "device_id": "android-main"
}
```

- `place_id` は places テーブルで管理する辞書
- `event`: `enter` / `exit` / `dwell`
- Tasker + AutoLocation のジオフェンスで自動送信

### Phase 2 以降（拡張予定）

| type | payload 例 | 備考 |
|------|-----------|------|
| `email` | subject, from, labels | ヘッダ中心、本文は含めない |
| `todo` | task_id, old_status, new_status | 状態遷移のみ |
| `vital` | sub_type (wake/sleep/exercise/watch_off) | 低次元の状態イベント |

## 圧縮パイプライン（n8n）

n8n が cron（5分間隔）で DB をポーリングし、3段の圧縮を行う。

```
① バッチ取得   : SELECT * FROM events WHERE processed_at IS NULL ORDER BY ts
② 集計        : 滞在セグメント化（enter → dwell → exit を1行に）
③ digest 生成 : OpenClaw 向けの短いテキスト or JSON に変換 → digests テーブルへ INSERT
④ 状態更新    : 対象 events の processed_at を現在時刻で UPDATE
⑤ 送信        : digests WHERE sent_at IS NULL → OpenClaw /hooks/agent へ POST
⑥ 送信確認    : 成功なら digests.sent_at を UPDATE、失敗なら次回バッチで再送
```

集計処理は n8n の Code ノードや外部スクリプト（TypeScript / Python）で実装可能。

### Phase 2 実装仕様（n8n 導入前に固定する内容）

以下は「先に決めるべき項目」を実装レベルまで落とした仕様。まずこの仕様に沿って workflow を作成する。

#### 1) ワークフロー責務

- Workflow A: `digest-build-and-mark`
  - Trigger: Cron（5分ごと）
  - 処理: 未処理イベント取得 → digest 生成 → `digests` INSERT → 対象 `events.processed_at` 更新
- Workflow B: `digest-send`
  - Trigger: Cron（1〜5分ごと）
  - 処理: 未送信 digest 取得 → OpenClaw 送信 → 成功時のみ `digests.sent_at` 更新

> 集計と送信を分離し、OpenClaw 停止時でも digest 生成処理を継続できる構成にする。

#### 2) 再送ポリシー（OpenClaw 送信失敗時）

- 送信対象: `digests.sent_at IS NULL`
- 再送間隔: `digest-send` の cron 周期に合わせて自動再送
- 最大再送回数: 当面は無制限（MVP）
- 再送制御カラム（追加推奨）:
  - `digests.send_attempts INT NOT NULL DEFAULT 0`
  - `digests.last_error TEXT NULL`
  - `digests.last_attempt_at TIMESTAMPTZ NULL`
- 失敗時更新:
  - `send_attempts = send_attempts + 1`
  - `last_error` に HTTP ステータス・レスポンス要約
  - `last_attempt_at = now()`
- 成功時更新:
  - `sent_at = now()`
  - `last_error = NULL`

#### 3) 二重実行・多重処理対策

`digest-build-and-mark` は DB ロックで取得対象を確定する。

- 取得クエリ方針（PostgreSQL）:
  - `FOR UPDATE SKIP LOCKED` を使用
  - 1バッチ上限件数（例: 200件）を設ける
- 例（概念）:

```sql
WITH picked AS (
  SELECT id
  FROM events
  WHERE processed_at IS NULL
  ORDER BY ts
  LIMIT 200
  FOR UPDATE SKIP LOCKED
)
SELECT e.*
FROM events e
JOIN picked p ON p.id = e.id
ORDER BY e.ts;
```

- digest 生成と `processed_at` 更新は同一トランザクション内で完了させる。

#### 4) 監視・運用指標（最低限）

次の 3 指標を定期確認する。

- `unprocessed_events_count`
  - `SELECT count(*) FROM events WHERE processed_at IS NULL;`
- `unsent_digests_count`
  - `SELECT count(*) FROM digests WHERE sent_at IS NULL;`
- `last_digest_sent_at`
  - `SELECT max(sent_at) FROM digests;`

アラート目安（MVP）:

- `unprocessed_events_count > 0` が 15 分以上継続
- `last_digest_sent_at` が 30 分以上更新なし（イベント発生中）

#### 5) 障害時の手動リカバリ手順

- 再送のみ行う場合（推奨）:
  - `sent_at IS NULL` の digest を再送対象として `digest-send` を手動実行
- `processed_at` の巻き戻しは原則禁止
  - 理由: 同一イベントから digest 重複が発生する可能性があるため
- 例外的に再集計が必要な場合:
  1. 対象期間を限定
  2. 既存 digest を退避（`type='location'` かつ期間一致）
  3. `processed_at` を戻す前に、再生成先 digest に一意キー（期間 + type）を設定
  4. 手順を運用ログに記録

#### 6) 受け入れ基準（Phase 2 完了条件）

- [ ] n8n の Workflow A/B が export 可能な形でリポジトリ管理されている
- [ ] OpenClaw 停止中でも digest が生成され続け、復旧後に自動送信される
- [ ] 同時実行時に同一 event の二重処理が発生しない
- [ ] 監視 3 指標を SQL で即時確認できる
- [ ] 手動再送手順が README 上で再現できる

### OpenClaw への送信フォーマット

```bash
POST https://<openclaw-vm>.exe.xyz/hooks/agent
Authorization: Bearer <OPENCLAW_HOOK_TOKEN>
Content-Type: application/json

{
  "message": "[LocationDigest] 10:00-10:25 自宅 → 10:30 オフィス到着",
  "name": "EventDigest",
  "wakeMode": "now",
  "deliver": true,
  "channel": "last"
}
```

- `wakeMode: "now"` で即座にエージェントを起動
- `deliver: true` + `channel: "last"` で最後に使ったチャンネルにメッセージ配信
- 失敗時は `digests.sent_at` が NULL のまま残り、次回バッチで再送
- `digest_id` を message に含めることで OpenClaw 側で重複判定が可能

## データベース設計

同一 PostgreSQL インスタンスに 2 つのデータベースを作成。

### eventdb（Prisma Migrate で管理）

```prisma
// prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Place {
  placeId   String   @id @map("place_id")
  label     String
  lat       Float?
  lng       Float?
  radiusM   Int      @default(100) @map("radius_m")
  createdAt DateTime @default(now()) @map("created_at")

  @@map("places")
}

model Event {
  id          BigInt    @id @default(autoincrement())
  eventId     String    @unique @map("event_id")  // UUID, 冪等キー
  type        String
  ts          DateTime
  payload     Json
  deviceId    String?   @map("device_id")
  meta        Json      @default("{}")
  processedAt DateTime? @map("processed_at")       // NULL = 未処理
  createdAt   DateTime  @default(now()) @map("created_at")

  @@index([type, ts])
  @@index([processedAt])
  @@map("events")
}

model Digest {
  id          BigInt    @id @default(autoincrement())
  periodStart DateTime  @map("period_start")
  periodEnd   DateTime  @map("period_end")
  type        String
  summary     Json
  sentAt      DateTime? @map("sent_at")            // NULL = 未送信
  createdAt   DateTime  @default(now()) @map("created_at")

  @@index([sentAt])
  @@map("digests")
}
```

### n8ndb

n8n が自動で作成・管理するので手動操作は不要。

### タイムゾーン規約

- DB には `timestamptz` で保存（Prisma の `DateTime` はデフォルトで timestamptz）
- API で `ts` が省略された場合はサーバー時刻（UTC）で補完
- digest の period は `[period_start, period_end)` 半開区間

## ディレクトリ構成

```
event-pipeline/
├── README.md
├── docker-compose.yml
├── .env                        # ← .gitignore 対象
├── .env.example
├── caddy/
│   ├── Caddyfile
│   └── certs/                  # Origin Cert + Key + Origin Pull CA
│       ├── origin.pem
│       ├── origin-key.pem
│       └── origin-pull-ca.pem
├── event-api/
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── prisma/
│   │   └── schema.prisma
│   └── src/
│       └── index.ts            # Hono / Fastify
├── db/
│   └── init.sh                 # DB 作成のみ（テーブルは Prisma で管理）
├── scripts/
│   └── digest-worker.ts        # n8n Code ノード用の集計ロジック
└── n8n/
    └── workflows/              # エクスポートした n8n ワークフロー JSON
```

## docker-compose.yml

```yaml
services:
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - ./caddy/Caddyfile:/etc/caddy/Caddyfile
      - ./caddy/certs:/etc/caddy/certs:ro
      - caddy_data:/data
      - caddy_config:/config

  event-api:
    build: ./event-api
    restart: unless-stopped
    environment:
      - DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/eventdb
      - API_TOKEN=${API_TOKEN}
    depends_on:
      - postgres
    expose:
      - "3000"

  n8n:
    image: n8nio/n8n:latest
    restart: unless-stopped
    environment:
      - DB_TYPE=postgresdb
      - DB_POSTGRESDB_HOST=postgres
      - DB_POSTGRESDB_PORT=5432
      - DB_POSTGRESDB_DATABASE=n8ndb
      - DB_POSTGRESDB_USER=${POSTGRES_USER}
      - DB_POSTGRESDB_PASSWORD=${POSTGRES_PASSWORD}
      # WEBHOOK_URL は設定しない（外部から叩かない）
      - GENERIC_TIMEZONE=Asia/Tokyo
      - EVENTDB_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/eventdb
    volumes:
      - n8n_data:/home/node/.n8n
    depends_on:
      - postgres
    expose:
      - "5678"
    # ports は公開しない — SSH トンネルでアクセス

  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      - POSTGRES_USER=${POSTGRES_USER}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
    volumes:
      - pg_data:/var/lib/postgresql/data
      - ./db/init.sh:/docker-entrypoint-initdb.d/init.sh
    expose:
      - "5432"

volumes:
  caddy_data:
  caddy_config:
  n8n_data:
  pg_data:
```

## .env.example

```bash
# Domain
DOMAIN=example.com
API_SUBDOMAIN=events

# PostgreSQL
POSTGRES_USER=pipeline
POSTGRES_PASSWORD=CHANGE_ME

# Event API
API_TOKEN=CHANGE_ME_LONG_RANDOM_STRING

# OpenClaw (exe.dev)
OPENCLAW_HOOK_URL=https://<vm-name>.exe.xyz/hooks/agent
OPENCLAW_HOOK_TOKEN=CHANGE_ME
```

## db/init.sh

```bash
#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
    CREATE DATABASE eventdb;
    CREATE DATABASE n8ndb;
EOSQL

# テーブル作成は Prisma Migrate で行うため、ここでは DB 作成のみ
```

## Caddyfile

```caddyfile
{
    email you@example.com
    auto_https off
}

{$API_SUBDOMAIN}.{$DOMAIN} {
    tls /etc/caddy/certs/origin.pem /etc/caddy/certs/origin-key.pem {
        client_auth {
            mode require_and_verify
            trusted_ca_cert_file /etc/caddy/certs/origin-pull-ca.pem
        }
    }
    reverse_proxy event-api:3000
}
```

## Cloudflare 設定チェックリスト

- [ ] サブドメイン `events.example.com` → さくら VPS IP（オレンジ雲 ON）
- [ ] SSL/TLS → 暗号化モード: **Full (Strict)**
- [ ] SSL/TLS → Origin Server → **Origin Certificate 作成**（RSA, 15年）→ `caddy/certs/` に配置
- [ ] SSL/TLS → Origin Server → **Authenticated Origin Pulls: ON**
- [ ] Origin Pull CA 証明書をダウンロード → `caddy/certs/origin-pull-ca.pem`
- [ ] WAF → Rate Limiting: `/events` に対して 100 req/min/IP
- [ ] WAF → Custom Rule: `POST` 以外のメソッドを `/events` でブロック
- [ ] さくら VPS パケットフィルタ: 80/443 を [Cloudflare IP](https://www.cloudflare.com/ips/) のみ許可

## Tasker 設定（Android）

### 必要なアプリ

- Tasker（有料）
- AutoLocation プラグイン（有料）— ジオフェンスに使用

### ジオフェンス → HTTP POST の構成

```
Profile: LocationEvent
  State: AutoLocation Geofences [Name: <場所名>, Enter/Exit: Both]

Enter Task:
  A1: Variable Set [%event → enter]
  A2: Perform Task [SendEvent]

Exit Task:
  A1: Variable Set [%event → exit]
  A2: Perform Task [SendEvent]
```

```
Task: SendEvent
  A1: Java Function [%uuid = randomUUID]
  A2: HTTP Request [
        Method: POST
        URL: https://events.example.com/events
        Headers:
          Content-Type: application/json
          Authorization: Bearer <API_TOKEN>
        Body: {
          "event_id": "%uuid",
          "type": "location",
          "payload": {
            "event": "%event",
            "place_id": "%algeofence",
            "lat": %allatitude,
            "lng": %allongitude,
            "accuracy_m": %alaccuracy
          },
          "device_id": "android-main"
        }
        Timeout: 30
      ]
```

- `ts` は ISO 8601 文字列（例: `2025-02-23T10:30:00+09:00`）が前提
- Tasker の `%TIMES` は Unix 秒で仕様不一致になるため、**`ts` は送らず Event API 側で補完**する運用を推奨

### バッテリー最適化

- WiFi 接続状態を自宅検知の第一手段にする（追加電力ゼロ）
- ジオフェンス監視は WiFi 切断時のみ有効化
- AutoLocation は Balanced Power モードを使用
- Tasker: GPS Check Time 300秒以上、GPS Timeout 30秒

## OpenClaw との連携

### アーキテクチャ

```
n8n (内部) → HTTP Request → OpenClaw /hooks/agent (exe.dev)
```

- n8n が cron で DB をポーリングし digest を生成
- digest を OpenClaw の webhook に POST（アウトバウンドのみ）
- OpenClaw は exe.dev 上で稼働（静的 IP なし → IP 制限ではなく Bearer Token で認証）

### 失敗時の再送

- `digests.sent_at IS NULL` の digest を次回バッチで再送
- n8n の HTTP Request ノードで retry（指数バックオフ）を設定
- digest_id を message に含め、OpenClaw 側で重複を認識可能にする

## マイルストーン

### Phase 0: インフラ構築

- [ ] さくら VPS 契約（推奨: 2GB RAM 以上）
- [ ] Ubuntu セットアップ、Docker / Docker Compose インストール
- [ ] パケットフィルタ設定（80/443 を Cloudflare IP のみ許可）
- [ ] Cloudflare: サブドメイン設定、Origin Certificate 発行、Full (Strict)、Authenticated Origin Pulls ON
- [ ] `caddy/certs/` に Origin Cert + Key + Origin Pull CA を配置
- [ ] `docker compose up` で Caddy + PostgreSQL 起動、HTTPS 確認
- [ ] SSH トンネルで n8n 管理画面にアクセスできることを確認
- 次アクション: VPS 上の初期セットアップ手順を `docs/runbook` に手順化する。

### Phase 1: Location イベント（MVP）

- [x] Event API 実装（Fastify + Prisma、Bearer Token 認証、冪等性）
- [x] Prisma schema / migration 適用（`events`, `digests`）
- [x] digest 保存 API と `sent_at` 更新 API を実装
- [ ] places テーブルに自宅・職場などの初期データ投入（未実装）
- [ ] Tasker + AutoLocation でジオフェンス設定、テスト送信（未実装）
- [ ] Cloudflare WAF: Rate Limiting + POST only ルール設定（未実装）
- [ ] n8n ワークフロー: cron(5分) → 未処理 events 取得 → 滞在セグメント化 → digests 保存 → processed_at 更新（未実装）
- 次アクション: n8n 側で digest 生成〜`processed_at` 更新までを先に自動化する。

### Phase 2: OpenClaw 統合の最適化

- [ ] OpenClaw workspace に skill 作成（未実装）
- [ ] タイミング制御（通勤中・帰宅後などに応じたメッセージング）（未実装）
- [ ] digest フォーマット最適化（未実装）
- [ ] pg_dump 日次バックアップの自動化（未実装）
- 次アクション: OpenClaw 送信のリトライ方針（上限・間隔）を仕様化する。

### Phase 3: イベントタイプ追加

- [ ] email イベント（ヘッダのみ）（未実装）
- [ ] todo ステータス変更イベント（未実装）
- [ ] vital イベント（起床・運動など）（未実装）
- 次アクション: `type` ごとの payload スキーマを先に固定する。

## 現在有効な API 一覧

> パスの正本は `/events`, `/digests`, `/digests/:digestId/sent`。

- `POST /events` : イベントの冪等保存（`event_id` 重複時は `duplicate: true`）
- `GET /events` : イベント一覧取得（`unprocessed_only`, `limit`）
- `POST /digests` : digest の冪等保存（`digest_id` 重複時は `duplicate: true`）
- `GET /digests` : digest 一覧取得（`unsent_only`, `limit`）
- `POST /digests/:digestId/sent` : `sent_at` を更新（未指定時は現在時刻）

## 未決事項

| 項目 | 選択肢 / メモ |
|------|--------------|
| VPS プラン | 2GB / 4GB — n8n + Postgres の常駐を考慮して決定 |
| 監視 / アラート | Uptime Kuma / Healthchecks.io 等 |
| バックアップ先 | pg_dump → さくらオブジェクトストレージ or S3 互換 |
| OpenClaw skill の詳細設計 | digest の解釈ルール、応答テンプレート |
| dwell イベントの生成方法 | Tasker 側 or n8n 側で滞在時間から生成 |

## 開発環境

- **ホスト OS**: Windows（Docker Desktop / WSL2）
- **本番**: さくら VPS（Ubuntu）
- **OpenClaw**: exe.dev

## 参考リンク

- [OpenClaw](https://github.com/openclaw/openclaw) — パーソナル AI アシスタント
- [OpenClaw Docs: Webhook](https://docs.openclaw.ai/automation/webhook)
- [OpenClaw Docs: exe.dev](https://docs.openclaw.ai/install/exe-dev)
- [n8n](https://n8n.io/) — ワークフロー自動化
- [Caddy](https://caddyserver.com/) — リバースプロキシ
- [Prisma](https://www.prisma.io/) — TypeScript ORM + Migration
- [Tasker](https://tasker.joaoapps.com/) — Android 自動化
- [AutoLocation](https://joaoapps.com/autolocation/) — Tasker ジオフェンスプラグイン
- [Cloudflare Origin Certificate](https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/)
- [Cloudflare Authenticated Origin Pulls](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/)
- [さくらの VPS](https://vps.sakura.ad.jp/)
