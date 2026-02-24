export class InMemoryEventRepository {
  constructor() {
    this.eventsById = new Map();
  }

  async healthcheck() {
    return true;
  }

  async insertEvent(envelope) {
    if (this.eventsById.has(envelope.event_id)) {
      return { inserted: false };
    }

    this.eventsById.set(envelope.event_id, {
      ...envelope,
      processed_at: null,
      created_at: new Date().toISOString(),
    });

    return { inserted: true };
  }
}
