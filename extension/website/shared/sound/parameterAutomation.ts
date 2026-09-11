// ABOUTME: Keeps parameter ramps continuous across running audio updates.
// ABOUTME: Calculates hold values from scheduled curves instead of render-thread snapshots.

interface ParameterEvent {
  time: number;
  value: number;
  kind: "set" | "linear" | "exponential" | "target";
  /**
   * Only on a "target" event: the time constant `setTargetAtTime` was given.
   * A target never lands on its value, so the hold value has to be computed
   * from the curve rather than read off the next event.
   */
  timeConstant?: number;
  /**
   * Only on a "target" event: the value in force when it was scheduled, which
   * is where the approach starts from.
   */
  startValue?: number;
}

/**
 * Where a `setTargetAtTime` curve has reached. It starts from the value in
 * force when the target was scheduled — recorded as the "set" event sitting at
 * the same instant — and approaches asymptotically, so it is only ever read,
 * never used as a ramp endpoint.
 */
function targetValueAt(event: ParameterEvent, time: number): number {
  const timeConstant = event.timeConstant ?? 0;
  if (timeConstant <= 0 || time <= event.time) return event.value;
  const start = event.startValue ?? event.value;
  return event.value + (start - event.value) * Math.exp(-(time - event.time) / timeConstant);
}

export class ParameterAutomation {
  private events = new WeakMap<AudioParam, ParameterEvent[]>();

  private valueAt(param: AudioParam, time: number): number {
    const events = this.events.get(param);
    if (!events?.length) return param.value;
    let previous = events[0];
    for (const next of events.slice(1)) {
      if (previous.kind === "target" && time < next.time) {
        return targetValueAt(previous, time);
      }
      if (next.time > time) {
        if (next.kind === "set" || next.kind === "target" || time <= previous.time)
          return previous.value;
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
    if (previous.kind === "target") return targetValueAt(previous, time);
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

  /**
   * Approach a value exponentially without ever scheduling an endpoint.
   *
   * This is the shape a settling envelope actually wants — an articulation
   * relaxing toward its sustain, a smoothed control following motion — because
   * it has no end to be interrupted at: a new target simply bends the curve
   * from wherever it had reached. Ramps have to be anchored and extended
   * against each other (see `SoundEngine.rampEndTime`); a target does not.
   */
  target(
    param: AudioParam,
    value: number,
    startTime: number,
    timeConstant: number,
  ): void {
    if (!this.events.has(param)) {
      this.record(param, {
        time: startTime,
        value: param.value,
        kind: "set",
      });
    }
    // The curve starts from whatever is rendered at `startTime`, so the hold
    // value is recorded as the anchor the interpolation above reads back.
    const anchor = this.valueAt(param, startTime);
    this.record(param, { time: startTime, value: anchor, kind: "set" });
    this.record(param, {
      time: startTime,
      value,
      kind: "target",
      timeConstant,
      startValue: anchor,
    });
    param.setTargetAtTime(value, startTime, timeConstant);
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
