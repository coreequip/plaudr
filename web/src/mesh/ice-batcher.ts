/** Sammelt ICE-Kandidaten und liefert sie gebündelt, um das Publish-Limit von room_ws zu schonen. */
export class IceBatcher {
  private pending: RTCIceCandidateInit[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly flush: (c: RTCIceCandidateInit[]) => void,
    private readonly intervalMs = 80,
  ) {}

  add(c: RTCIceCandidateInit | null): void {
    if (c === null) {
      this.deliver();
      return;
    }
    this.pending.push(c);
    this.timer ??= setTimeout(() => this.deliver(), this.intervalMs);
  }

  dispose(): void {
    this.clearTimer();
    this.pending = [];
  }

  private deliver(): void {
    this.clearTimer();
    if (this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];
    this.flush(batch);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
