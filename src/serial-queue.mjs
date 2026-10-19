/**
 * One in-flight turn per provider.
 *
 * The plan's hard invariant is one browser turn per profile: two concurrent turns break the
 * bridge's Chrome session (exit 21). The hub therefore serializes turns per provider and keeps
 * other providers independent.
 */
export class ProviderQueues {
  constructor() {
    this.chains = new Map();
    this.active = new Map();
  }

  /** Run `task` after every previously queued turn for this provider has settled. */
  run(providerId, task) {
    const previous = this.chains.get(providerId) ?? Promise.resolve();
    const next = previous.then(task, task);
    this.chains.set(providerId, next.then(() => undefined, () => undefined));
    this.active.set(providerId, (this.active.get(providerId) ?? 0) + 1);
    return next.finally(() => {
      const remaining = (this.active.get(providerId) ?? 1) - 1;
      if (remaining <= 0) this.active.delete(providerId);
      else this.active.set(providerId, remaining);
    });
  }

  activeCount(providerId) {
    return this.active.get(providerId) ?? 0;
  }
}
