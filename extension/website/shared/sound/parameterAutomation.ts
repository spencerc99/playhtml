// ABOUTME: Keeps parameter ramps continuous across running audio updates.
// ABOUTME: Calculates hold values from scheduled curves instead of render-thread snapshots.

interface ParameterEvent {
  time: number;
  value: number;
  kind: "set" | "linear" | "exponential";
}

export class ParameterAutomation {
  private events = new WeakMap<AudioParam, ParameterEvent[]>();

  private valueAt(param: AudioParam, time: number): number {
    const events = this.events.get(param);
    if (!events?.length) return param.value;
    let previous = events[0];
    for (const next of events.slice(1)) {
      if (next.time > time) {
        if (next.kind === "set" || time <= previous.time) return previous.value;
        const progress = (time - previous.time) / (next.time - previous.time);
        if (next.kind === "exponential") {
          if (previous.value === 0 || previous.value * next.value < 0)
            return previous.value;
          return (
            previous.value * Math.pow(next.value / previous.value, progress)
          );
        }
        return previous.value + (next.value - previous.value) * progress;
      }
      previous = next;
    }
    return previous.value;
  }

  private record(param: AudioParam, event: ParameterEvent): void {
    const events = this.events.get(param) ?? [];
    const matching = events.findIndex(
      (prior) => prior.time === event.time && prior.kind === event.kind,
    );
    if (matching >= 0) events[matching] = event;
    else events.push(event);
    events.sort((a, b) => a.time - b.time);
    this.events.set(param, events);
  }

  reset(param: AudioParam): void {
    this.events.delete(param);
  }

  set(param: AudioParam, value: number, time: number): void {
    param.setValueAtTime(value, time);
    this.record(param, { time, value, kind: "set" });
  }

  linear(param: AudioParam, value: number, end: number, now: number): void {
    this.ramp(param, value, end, now, "linear");
  }

  exponential(
    param: AudioParam,
    value: number,
    end: number,
    now: number,
  ): void {
    this.ramp(param, value, end, now, "exponential");
  }

  private ramp(
    param: AudioParam,
    value: number,
    end: number,
    now: number,
    kind: "linear" | "exponential",
  ): void {
    if (!this.events.has(param)) {
      this.record(param, { time: now, value: param.value, kind: "set" });
    }
    this.record(param, { time: end, value, kind });
    if (kind === "exponential") param.exponentialRampToValueAtTime(value, end);
    else param.linearRampToValueAtTime(value, end);
  }

  hold(param: AudioParam, time: number): void {
    const value = this.valueAt(param, time);
    const hold = (
      param as AudioParam & {
        cancelAndHoldAtTime?: (time: number) => void;
      }
    ).cancelAndHoldAtTime;
    if (hold) {
      const next = this.events.get(param)?.find((event) => event.time > time);
      hold.call(param, time);
      // Preserve the incoming curve when the hold interrupts a ramp. A set
      // event here would erase that curve in a pre-scheduled render.
      if (next?.kind === "linear") param.linearRampToValueAtTime(value, time);
      else if (next?.kind === "exponential")
        param.exponentialRampToValueAtTime(value, time);
      else param.setValueAtTime(value, time);
      this.events.set(param, [{ time, value, kind: "set" }]);
      return;
    }
    param.cancelScheduledValues(time);
  }
}
