/**
 * digest-worker.ts — n8n Code ノード用の集計ロジック
 *
 * n8n の cron(5分) → Code ノードで実行される想定。
 * 未処理の location イベントを取得し、滞在セグメント化して digest を生成する。
 *
 * 圧縮パイプライン:
 * ① バッチ取得   : events WHERE processed_at IS NULL ORDER BY ts
 * ② 集計        : 滞在セグメント化（enter → dwell → exit を1行に）
 * ③ digest 生成 : OpenClaw 向けの短いテキストに変換
 * ④ 状態更新    : 対象 events の processed_at を UPDATE
 * ⑤ 送信        : digests WHERE sent_at IS NULL → OpenClaw へ POST
 * ⑥ 送信確認    : 成功なら sent_at を UPDATE
 *
 * n8n から使う場合:
 *   - HTTP Request ノードで Event API を呼び出す
 *   - Code ノードでこのロジックを実行
 *   - HTTP Request ノードで digest 保存と OpenClaw 送信を行う
 *
 * スタンドアロンで使う場合:
 *   npx tsx scripts/digest-worker.ts
 */

// --- Types ---

interface RawEvent {
  event_id: string;
  type: string;
  ts: string;
  payload: Record<string, unknown>;
  device_id: string | null;
  meta: Record<string, unknown> | null;
  processed_at: string | null;
}

interface LocationPayload {
  event: "enter" | "exit" | "dwell";
  place_id: string;
  lat?: number;
  lng?: number;
  accuracy_m?: number;
}

interface StaySegment {
  place_id: string;
  enter_at: string;
  exit_at: string | null;
  duration_min: number | null;
}

interface DigestResult {
  digest_id: string;
  message: string;
  payload: {
    type: "location";
    segments: StaySegment[];
    period_start: string;
    period_end: string;
    event_ids: string[];
  };
}

// --- Helpers ---

function formatTime(isoStr: string): string {
  const d = new Date(isoStr);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

function generateUUID(): string {
  return crypto.randomUUID();
}

// --- Core Logic ---

/**
 * 未処理の location イベントを滞在セグメントに集約する。
 * enter → (dwell) → exit を1つのセグメントとしてまとめる。
 */
export function aggregateLocationEvents(events: RawEvent[]): {
  segments: StaySegment[];
  eventIds: string[];
} {
  const locationEvents = events
    .filter((e) => e.type === "location")
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  if (locationEvents.length === 0) {
    return { segments: [], eventIds: [] };
  }

  const segments: StaySegment[] = [];
  const eventIds: string[] = [];
  let currentSegment: StaySegment | null = null;

  for (const event of locationEvents) {
    const payload = event.payload as unknown as LocationPayload;
    eventIds.push(event.event_id);

    switch (payload.event) {
      case "enter":
        // 前のセグメントが閉じていなければ閉じる
        if (currentSegment && currentSegment.exit_at === null) {
          currentSegment.exit_at = event.ts;
          const enterTime = new Date(currentSegment.enter_at).getTime();
          const exitTime = new Date(event.ts).getTime();
          currentSegment.duration_min = Math.round((exitTime - enterTime) / 60000);
        }

        currentSegment = {
          place_id: payload.place_id,
          enter_at: event.ts,
          exit_at: null,
          duration_min: null,
        };
        segments.push(currentSegment);
        break;

      case "dwell":
        // dwell は既存のセグメントに吸収（新規なら enter 扱い）
        if (!currentSegment || currentSegment.place_id !== payload.place_id) {
          currentSegment = {
            place_id: payload.place_id,
            enter_at: event.ts,
            exit_at: null,
            duration_min: null,
          };
          segments.push(currentSegment);
        }
        break;

      case "exit":
        if (currentSegment && currentSegment.place_id === payload.place_id) {
          currentSegment.exit_at = event.ts;
          const enterTime = new Date(currentSegment.enter_at).getTime();
          const exitTime = new Date(event.ts).getTime();
          currentSegment.duration_min = Math.round((exitTime - enterTime) / 60000);
          currentSegment = null;
        } else {
          // exit without matching enter — record as instant segment
          segments.push({
            place_id: payload.place_id,
            enter_at: event.ts,
            exit_at: event.ts,
            duration_min: 0,
          });
        }
        break;
    }
  }

  return { segments, eventIds };
}

/**
 * セグメントから OpenClaw 向けの digest メッセージを生成する。
 * 例: "[LocationDigest] 10:00-10:25 自宅 → 10:30 オフィス到着"
 */
export function buildDigestMessage(segments: StaySegment[]): string {
  if (segments.length === 0) {
    return "[LocationDigest] イベントなし";
  }

  const parts = segments.map((seg) => {
    const enter = formatTime(seg.enter_at);
    if (seg.exit_at && seg.exit_at !== seg.enter_at) {
      const exit = formatTime(seg.exit_at);
      return `${enter}-${exit} ${seg.place_id}`;
    }
    return `${enter} ${seg.place_id}到着`;
  });

  return `[LocationDigest] ${parts.join(" → ")}`;
}

/**
 * イベント配列から digest を生成する。
 * 非 location イベントも含めて全 event_id を返す。
 */
export function generateDigest(events: RawEvent[]): DigestResult | null {
  if (events.length === 0) return null;

  const allEventIds = events.map((e) => e.event_id);
  const { segments } = aggregateLocationEvents(events);

  // 非 location イベントの簡易集計
  const nonLocationEvents = events.filter((e) => e.type !== "location");
  const nonLocationSummaryParts: string[] = [];

  const emailCount = nonLocationEvents.filter((e) => e.type === "email").length;
  const todoCount = nonLocationEvents.filter((e) => e.type === "todo").length;
  const vitalCount = nonLocationEvents.filter((e) => e.type === "vital").length;

  if (emailCount > 0) nonLocationSummaryParts.push(`メール${emailCount}件`);
  if (todoCount > 0) nonLocationSummaryParts.push(`タスク変更${todoCount}件`);
  if (vitalCount > 0) nonLocationSummaryParts.push(`バイタル${vitalCount}件`);

  const locationMessage = buildDigestMessage(segments);
  const message = nonLocationSummaryParts.length > 0
    ? `${locationMessage} | ${nonLocationSummaryParts.join(", ")}`
    : locationMessage;

  const timestamps = events.map((e) => new Date(e.ts).getTime());
  const periodStart = new Date(Math.min(...timestamps)).toISOString();
  const periodEnd = new Date(Math.max(...timestamps)).toISOString();

  return {
    digest_id: generateUUID(),
    message,
    payload: {
      type: "location",
      segments,
      period_start: periodStart,
      period_end: periodEnd,
      event_ids: allEventIds,
    },
  };
}

/**
 * OpenClaw 送信用のリクエストボディを構築する。
 */
export function buildOpenClawPayload(digest: DigestResult): {
  message: string;
  name: string;
  wakeMode: string;
  deliver: boolean;
  channel: string;
} {
  return {
    message: `[digest:${digest.digest_id}] ${digest.message}`,
    name: "EventDigest",
    wakeMode: "now",
    deliver: true,
    channel: "last",
  };
}

// --- Standalone execution ---

async function main() {
  const baseUrl = process.env.EVENT_API_URL ?? "http://localhost:3000";
  const token = process.env.EVENT_API_TOKEN;
  const openClawUrl = process.env.OPENCLAW_HOOK_URL;
  const openClawToken = process.env.OPENCLAW_HOOK_TOKEN;

  if (!token) {
    console.error("EVENT_API_TOKEN is required");
    process.exit(1);
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  // ① バッチ取得: 未処理イベントを取得
  console.log("Fetching unprocessed events...");
  const eventsRes = await fetch(`${baseUrl}/events?unprocessed_only=true&limit=500`, {
    headers,
  });

  if (!eventsRes.ok) {
    console.error(`Failed to fetch events: ${eventsRes.status}`);
    process.exit(1);
  }

  const { events } = (await eventsRes.json()) as { events: RawEvent[] };
  console.log(`Found ${events.length} unprocessed events`);

  if (events.length === 0) {
    console.log("No events to process");
    return;
  }

  // ② ③ 集計 & digest 生成
  const digest = generateDigest(events);
  if (!digest) {
    console.log("No digest generated");
    return;
  }

  console.log(`Generated digest: ${digest.message}`);

  // ③ digest 保存
  const digestRes = await fetch(`${baseUrl}/digests`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      digest_id: digest.digest_id,
      payload: digest.payload,
      message: digest.message,
    }),
  });

  if (!digestRes.ok) {
    console.error(`Failed to save digest: ${digestRes.status}`);
    process.exit(1);
  }

  console.log(`Saved digest: ${digest.digest_id}`);

  // ④ 状態更新: 対象 events の processed_at を UPDATE
  const processRes = await fetch(`${baseUrl}/events/process`, {
    method: "POST",
    headers,
    body: JSON.stringify({ event_ids: digest.payload.event_ids }),
  });

  if (!processRes.ok) {
    console.error(`Failed to mark events processed: ${processRes.status}`);
    process.exit(1);
  }

  const processResult = (await processRes.json()) as { processed_count: number };
  console.log(`Marked ${processResult.processed_count} events as processed`);

  // ⑤ 送信: OpenClaw へ POST
  if (openClawUrl && openClawToken) {
    console.log("Sending digest to OpenClaw...");

    const openClawPayload = buildOpenClawPayload(digest);

    const sendRes = await fetch(openClawUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openClawToken}`,
      },
      body: JSON.stringify(openClawPayload),
    });

    if (sendRes.ok) {
      // ⑥ 送信確認: sent_at を UPDATE
      await fetch(`${baseUrl}/digests/${digest.digest_id}/sent`, {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      });
      console.log("Digest sent to OpenClaw and marked as sent");
    } else {
      console.error(`OpenClaw send failed: ${sendRes.status} — will retry next batch`);
    }
  } else {
    console.log("OpenClaw credentials not configured, skipping send");
  }

  // ⑤ 未送信 digest の再送
  const unsentRes = await fetch(`${baseUrl}/digests?unsent_only=true`, { headers });
  if (unsentRes.ok && openClawUrl && openClawToken) {
    const { digests: unsentDigests } = (await unsentRes.json()) as {
      digests: Array<{ digest_id: string; message: string; payload: Record<string, unknown> }>;
    };

    for (const unsent of unsentDigests) {
      // 今回生成した digest は既に送信済みのためスキップ
      if (unsent.digest_id === digest.digest_id) continue;

      console.log(`Retrying unsent digest: ${unsent.digest_id}`);

      const retryPayload = {
        message: `[digest:${unsent.digest_id}] ${unsent.message}`,
        name: "EventDigest",
        wakeMode: "now",
        deliver: true,
        channel: "last",
      };

      const retryRes = await fetch(openClawUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openClawToken}`,
        },
        body: JSON.stringify(retryPayload),
      });

      if (retryRes.ok) {
        await fetch(`${baseUrl}/digests/${unsent.digest_id}/sent`, {
          method: "POST",
          headers,
          body: JSON.stringify({}),
        });
        console.log(`Retry succeeded for digest: ${unsent.digest_id}`);
      } else {
        console.error(`Retry failed for digest: ${unsent.digest_id} — ${retryRes.status}`);
      }
    }
  }

  console.log("Digest worker completed");
}

// Run if executed directly
const isMainModule = process.argv[1]?.endsWith("digest-worker.ts");
if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
