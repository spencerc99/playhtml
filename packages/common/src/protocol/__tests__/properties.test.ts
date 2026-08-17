// ABOUTME: Exercises version 2 protocol convergence and recorder invariants with generated programs.
// ABOUTME: Simulates ordered server delivery, optimistic clients, retries, and generation resets in process.

import fc from "fast-check";
import { produce } from "immer";
import { describe, expect, it } from "vitest";
import { applyOperation, checkSnapshotIntegrity } from "../engine";
import type {
  ClientId,
  IncrementOperation,
  Operation,
  RoomSnapshot,
  SequencedOperation,
} from "../index";
import { recordMutation } from "../record";

type BasicAction =
  | { readonly type: "increment"; readonly delta: number }
  | { readonly type: "set"; readonly value: string }
  | { readonly type: "insert"; readonly index: number };

type ClientCase = {
  readonly programs: readonly (readonly BasicAction[])[];
  readonly choices: readonly number[];
};

type AdditiveAction =
  | { readonly type: "increment"; readonly delta: number }
  | { readonly type: "insert"; readonly index: number };

type AdditiveCase = {
  readonly programs: readonly (readonly AdditiveAction[])[];
  readonly choices: readonly number[];
};

type SetCase = {
  readonly programs: readonly (readonly string[])[];
  readonly choices: readonly number[];
};

type ClientMessage = {
  readonly clientId: ClientId;
  readonly generation: number;
  readonly mutationId: number;
  readonly operation: Operation;
};

type Replica = {
  authoritative: RoomSnapshot;
  generation: number;
  pending: ClientMessage[];
  sequence: number;
  view: RoomSnapshot;
};

type Simulation = {
  readonly clients: readonly Replica[];
  readonly log: readonly SequencedOperation[];
  readonly server: RoomSnapshot;
};

type RecorderItem = {
  name: string;
  score: number;
  tags: number[];
};

type RecorderData = {
  count: number;
  nested: {
    label: string;
    remove: string;
    value: number;
  };
  items: RecorderItem[];
  optional?: {
    values: number[];
  };
};

type MutationStep =
  | { readonly type: "nested-assignment"; readonly label: string; readonly value: number }
  | { readonly type: "push"; readonly items: readonly RecorderItem[] }
  | { readonly type: "unshift"; readonly item: RecorderItem }
  | { readonly type: "splice-insert"; readonly index: number; readonly item: RecorderItem }
  | { readonly type: "splice-remove"; readonly index: number }
  | { readonly type: "splice-replace"; readonly index: number; readonly item: RecorderItem }
  | { readonly type: "index-write"; readonly index: number; readonly item: RecorderItem }
  | { readonly type: "pop" }
  | { readonly type: "shift" }
  | { readonly type: "delete" }
  | { readonly type: "length-truncate"; readonly length: number }
  | { readonly type: "nullish-init"; readonly values: readonly number[] };

const elementAddress = {
  capability: "play",
  elementId: "element",
} as const;

const snapshot = (): RoomSnapshot => ({
  state: {
    play: {
      element: {
        choice: "initial",
        count: 0,
        items: [],
      },
    },
  },
  arrays: [
    {
      ...elementAddress,
      path: ["items"],
      itemIds: [],
    },
  ],
  lastMutationIds: {},
});

const recorderSnapshot = (): RoomSnapshot => ({
  state: {
    play: {
      element: {
        count: 1,
        nested: {
          label: "before",
          remove: "remove-me",
          value: 2,
        },
        items: [
          { name: "a", score: 1, tags: [1] },
          { name: "b", score: 2, tags: [] },
        ],
      },
    },
  },
  arrays: [
    {
      ...elementAddress,
      path: ["items"],
      itemIds: ["item-a", "item-b"],
    },
    {
      ...elementAddress,
      path: ["items", { itemId: "item-a" }, "tags"],
      itemIds: ["tag-a"],
    },
    {
      ...elementAddress,
      path: ["items", { itemId: "item-b" }, "tags"],
      itemIds: [],
    },
  ],
  lastMutationIds: {},
});

const integrity = (value: RoomSnapshot): void => {
  const result = checkSnapshotIntegrity(value);
  if (!result.ok) throw new Error(result.message);
};

const apply = (input: RoomSnapshot, operation: Operation): RoomSnapshot => {
  const result = applyOperation(input, operation);
  if (!result.ok) throw new Error(result.message);
  integrity(result.snapshot);
  return result.snapshot;
};

const withLastMutationId = (
  value: RoomSnapshot,
  clientId: ClientId,
  mutationId: number,
): RoomSnapshot => ({
  ...value,
  lastMutationIds: {
    ...value.lastMutationIds,
    [clientId]: Math.max(value.lastMutationIds[clientId] ?? 0, mutationId),
  },
});

const operationForAction = (
  clientIndex: number,
  mutationId: number,
  action: BasicAction,
): Operation => {
  switch (action.type) {
    case "increment":
      return {
        type: "increment",
        ...elementAddress,
        path: ["count"],
        delta: action.delta,
      } satisfies IncrementOperation;
    case "set":
      return {
        type: "set",
        ...elementAddress,
        path: ["choice"],
        value: `${action.value}:${clientIndex}:${mutationId}`,
        arrays: [],
      };
    case "insert":
      return {
        type: "insert",
        ...elementAddress,
        path: ["items"],
        target: {
          kind: "array",
          index: action.index,
          itemId: `item-${clientIndex}-${mutationId}`,
        },
        value: { client: clientIndex, mutation: mutationId },
        arrays: [],
      };
  }
};

const messagesForPrograms = (
  programs: readonly (readonly BasicAction[])[],
): ClientMessage[][] =>
  programs.map((program, clientIndex) => {
    const clientId = `client-${clientIndex}`;
    return program.map((action, index) => ({
      clientId,
      generation: 0,
      mutationId: index + 1,
      operation: operationForAction(clientIndex, index + 1, action),
    }));
  });

const additiveMessages = (
  programs: readonly (readonly AdditiveAction[])[],
): ClientMessage[][] =>
  programs.map((program, clientIndex) => {
    const clientId = `client-${clientIndex}`;
    return program.map((action, index) => {
      const mutationId = index + 1;
      if (action.type === "increment") {
        return {
          clientId,
          generation: 0,
          mutationId,
          operation: {
            type: "increment",
            ...elementAddress,
            path: ["count"],
            delta: action.delta,
          },
        };
      }
      return {
        clientId,
        generation: 0,
        mutationId,
        operation: {
          type: "insert",
          ...elementAddress,
          path: ["items"],
          target: {
            kind: "array",
            index: action.index,
            itemId: `item-${clientIndex}-${mutationId}`,
          },
          value: { client: clientIndex, mutation: mutationId },
          arrays: [],
        },
      };
    });
  });

const setMessages = (
  programs: readonly (readonly string[])[],
): ClientMessage[][] =>
  programs.map((program, clientIndex) => {
    const clientId = `client-${clientIndex}`;
    return program.map((value, index) => ({
      clientId,
      generation: 0,
      mutationId: index + 1,
      operation: {
        type: "set",
        ...elementAddress,
        path: ["choice"],
        value: `${value}:${clientIndex}:${index + 1}`,
        arrays: [],
      },
    }));
  });

const interleave = (
  queues: readonly (readonly ClientMessage[])[],
  choices: readonly number[],
): ClientMessage[] => {
  const positions = queues.map(() => 0);
  const order: ClientMessage[] = [];

  for (let step = 0; step < queues.reduce((sum, queue) => sum + queue.length, 0); step++) {
    const available = queues.flatMap((queue, clientIndex) =>
      positions[clientIndex] < queue.length ? [clientIndex] : [],
    );
    const clientIndex = available[choices[step] % available.length];
    order.push(queues[clientIndex][positions[clientIndex]]);
    positions[clientIndex] += 1;
  }

  return order;
};

const makeReplica = (initial: RoomSnapshot): Replica => ({
  authoritative: structuredClone(initial),
  generation: 0,
  pending: [],
  sequence: 0,
  view: structuredClone(initial),
});

const queueOptimistically = (
  replica: Replica,
  messages: readonly ClientMessage[],
): void => {
  for (const message of messages) {
    replica.pending.push(message);
    replica.view = apply(replica.view, message.operation);
  }
};

const rederive = (replica: Replica): void => {
  replica.view = replica.authoritative;
  for (const pending of replica.pending) {
    const result = applyOperation(replica.view, pending.operation);
    if (result.ok) replica.view = result.snapshot;
    integrity(replica.view);
  }
};

const receive = (replica: Replica, envelope: SequencedOperation): void => {
  if (
    envelope.generation !== replica.generation ||
    envelope.sequence <= replica.sequence
  ) {
    return;
  }

  replica.authoritative = withLastMutationId(
    apply(replica.authoritative, envelope.operation),
    envelope.clientId,
    envelope.mutationId,
  );
  replica.sequence = envelope.sequence;
  if (envelope.clientId === (replica.pending[0]?.clientId ?? "")) {
    replica.pending = replica.pending.filter(
      (pending) => pending.mutationId !== envelope.mutationId,
    );
  }
  rederive(replica);
  integrity(replica.authoritative);
  integrity(replica.view);
};

const runSimulation = (
  queues: readonly (readonly ClientMessage[])[],
  choices: readonly number[],
): Simulation => {
  const initial = snapshot();
  const clients = queues.map(() => makeReplica(initial));
  queues.forEach((queue, index) => queueOptimistically(clients[index], queue));

  let server = structuredClone(initial);
  let sequence = 0;
  const log: SequencedOperation[] = [];
  for (const message of interleave(queues, choices)) {
    if (message.generation !== 0) continue;
    if (message.mutationId <= (server.lastMutationIds[message.clientId] ?? 0)) {
      continue;
    }
    server = apply(server, message.operation);
    server = withLastMutationId(server, message.clientId, message.mutationId);
    sequence += 1;
    const envelope = {
      sequence,
      generation: 0,
      clientId: message.clientId,
      mutationId: message.mutationId,
      operation: message.operation,
    } satisfies SequencedOperation;
    log.push(envelope);
    clients.forEach((client) => receive(client, envelope));
    integrity(server);
  }

  return { clients, log, server };
};

const clientCaseArb: fc.Arbitrary<ClientCase> = fc.record({
  choices: fc.array(fc.nat(), { minLength: 16, maxLength: 16 }),
  programs: fc.array(
    fc.array(
      fc.oneof(
        fc.integer({ min: -5, max: 5 }).filter((delta) => delta !== 0).map((delta) => ({
          type: "increment" as const,
          delta,
        })),
        fc.string({ maxLength: 6 }).map((value) => ({
          type: "set" as const,
          value,
        })),
        fc.integer({ min: 0, max: 8 }).map((index) => ({
          type: "insert" as const,
          index,
        })),
      ),
      { minLength: 1, maxLength: 4 },
    ),
    { minLength: 2, maxLength: 4 },
  ),
});

const additiveCaseArb: fc.Arbitrary<AdditiveCase> = fc.record({
  choices: fc.array(fc.nat(), { minLength: 16, maxLength: 16 }),
  programs: fc.array(
    fc.array(
      fc.oneof(
        fc.integer({ min: -5, max: 5 }).filter((delta) => delta !== 0).map((delta) => ({
          type: "increment" as const,
          delta,
        })),
        fc.integer({ min: 0, max: 8 }).map((index) => ({
          type: "insert" as const,
          index,
        })),
      ),
      { minLength: 1, maxLength: 4 },
    ),
    { minLength: 2, maxLength: 4 },
  ),
});

const setCaseArb: fc.Arbitrary<SetCase> = fc.record({
  choices: fc.array(fc.nat(), { minLength: 16, maxLength: 16 }),
  programs: fc.array(
    fc.array(fc.string({ maxLength: 6 }), { minLength: 1, maxLength: 4 }),
    { minLength: 2, maxLength: 4 },
  ),
});

const recorderItemArb: fc.Arbitrary<RecorderItem> = fc.record({
  name: fc.string({ maxLength: 4 }),
  score: fc.integer({ min: -5, max: 5 }),
  tags: fc.array(fc.integer({ min: -3, max: 3 }), { maxLength: 3 }),
});

const mutationStepArb: fc.Arbitrary<MutationStep> = fc.oneof(
  fc.record({
    type: fc.constant("nested-assignment" as const),
    label: fc.string({ maxLength: 5 }),
    value: fc.integer({ min: -5, max: 5 }),
  }),
  fc.record({
    type: fc.constant("push" as const),
    items: fc.array(recorderItemArb, { minLength: 1, maxLength: 2 }),
  }),
  recorderItemArb.map((item) => ({ type: "unshift" as const, item })),
  fc.record({
    type: fc.constant("splice-insert" as const),
    index: fc.integer({ min: 0, max: 5 }),
    item: recorderItemArb,
  }),
  fc.record({
    type: fc.constant("splice-remove" as const),
    index: fc.integer({ min: 0, max: 5 }),
  }),
  fc.record({
    type: fc.constant("splice-replace" as const),
    index: fc.integer({ min: 0, max: 5 }),
    item: recorderItemArb,
  }),
  fc.record({
    type: fc.constant("index-write" as const),
    index: fc.integer({ min: 0, max: 5 }),
    item: recorderItemArb,
  }),
  fc.constant({ type: "pop" as const }),
  fc.constant({ type: "shift" as const }),
  fc.constant({ type: "delete" as const }),
  fc.record({
    type: fc.constant("length-truncate" as const),
    length: fc.integer({ min: 0, max: 5 }),
  }),
  fc.record({
    type: fc.constant("nullish-init" as const),
    values: fc.array(fc.integer({ min: -3, max: 3 }), { maxLength: 3 }),
  }),
);

const runProgram = (draft: RecorderData, program: readonly MutationStep[]): void => {
  for (const step of program) {
    switch (step.type) {
      case "nested-assignment":
        draft.nested.value = step.value;
        draft.nested.label = step.label;
        break;
      case "push":
        draft.items.push(...step.items);
        break;
      case "unshift":
        draft.items.unshift(step.item);
        break;
      case "splice-insert":
        draft.items.splice(step.index, 0, step.item);
        break;
      case "splice-remove":
        if (draft.items.length > 0) {
          draft.items.splice(step.index % draft.items.length, 1);
        }
        break;
      case "splice-replace":
        if (draft.items.length > 0) {
          draft.items.splice(step.index % draft.items.length, 1, step.item);
        }
        break;
      case "index-write":
        if (draft.items.length > 0) {
          draft.items[step.index % draft.items.length] = step.item;
        }
        break;
      case "pop":
        draft.items.pop();
        break;
      case "shift":
        draft.items.shift();
        break;
      case "delete":
        delete draft.nested.remove;
        break;
      case "length-truncate":
        draft.items.length = Math.min(draft.items.length, step.length);
        break;
      case "nullish-init":
        draft.optional ??= { values: [...step.values] };
        break;
    }
  }
};

const applyLog = (
  input: RoomSnapshot,
  entries: readonly SequencedOperation[],
): RoomSnapshot => {
  let value = structuredClone(input);
  for (const entry of entries) {
    if (entry.mutationId <= (value.lastMutationIds[entry.clientId] ?? 0)) {
      continue;
    }
    value = withLastMutationId(apply(value, entry.operation), entry.clientId, entry.mutationId);
  }
  return value;
};

describe("version 2 protocol properties", () => {
  it("converges optimistic clients after random ordered interleavings", () => {
    fc.assert(
      fc.property(clientCaseArb, ({ choices, programs }) => {
        const result = runSimulation(messagesForPrograms(programs), choices);
        for (const client of result.clients) {
          expect(client.pending).toHaveLength(0);
          expect(client.view).toEqual(result.server);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("preserves every accepted addition and increment", () => {
    fc.assert(
      fc.property(additiveCaseArb, ({ choices, programs }) => {
        const result = runSimulation(additiveMessages(programs), choices);
        const acceptedInserts = result.log.filter(
          (entry) => entry.operation.type === "insert",
        );
        const acceptedIncrements = result.log.filter(
          (entry): entry is SequencedOperation & { operation: IncrementOperation } =>
            entry.operation.type === "increment",
        );
        const items = result.server.state.play.element as {
          count: number;
          items: readonly unknown[];
        };
        const itemIds = result.server.arrays.find(
          (entry) => entry.path.length === 1 && entry.path[0] === "items",
        )?.itemIds;
        if (!itemIds) throw new Error("Final item identity sidecar is missing");

        const acceptedItemIds = acceptedInserts.map((entry) => {
          if (entry.operation.type !== "insert" || entry.operation.target.kind !== "array") {
            throw new Error("Accepted addition is not an array insert");
          }
          return entry.operation.target.itemId;
        });
        expect(itemIds).toHaveLength(acceptedItemIds.length);
        expect(new Set(itemIds).size).toBe(itemIds.length);
        expect([...itemIds].sort()).toEqual([...acceptedItemIds].sort());
        expect(items.count).toBe(
          acceptedIncrements.reduce((sum, entry) => sum + entry.operation.delta, 0),
        );
      }),
      { numRuns: 100 },
    );
  });

  it("resolves set conflicts to one complete contender value", () => {
    fc.assert(
      fc.property(setCaseArb, ({ choices, programs }) => {
        const result = runSimulation(setMessages(programs), choices);
        const contenders = result.log.flatMap((entry) =>
          entry.operation.type === "set" ? [entry.operation.value] : [],
        );
        const choice = (result.server.state.play.element as { choice: unknown }).choice;
        expect(contenders).toContain(choice);
        expect(typeof choice).toBe("string");
        for (const client of result.clients) expect(client.view).toEqual(result.server);
      }),
      { numRuns: 100 },
    );
  });

  it("makes replaying every server-log prefix idempotent", () => {
    fc.assert(
      fc.property(clientCaseArb, ({ choices, programs }) => {
        const result = runSimulation(messagesForPrograms(programs), choices);
        const initial = snapshot();
        for (let length = 0; length <= result.log.length; length++) {
          const prefix = result.log.slice(0, length);
          const once = applyLog(initial, prefix);
          const twice = applyLog(once, prefix);
          expect(twice).toEqual(once);
          expect(applyLog(result.server, prefix)).toEqual(result.server);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("keeps the array sidecar integral after every applied operation", () => {
    fc.assert(
      fc.property(clientCaseArb, ({ choices, programs }) => {
        const result = runSimulation(messagesForPrograms(programs), choices);
        integrity(result.server);
        for (const client of result.clients) {
          integrity(client.authoritative);
          integrity(client.view);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("round-trips random recorder programs through the operation engine", () => {
    fc.assert(
      fc.property(
        fc.array(mutationStepArb, { minLength: 1, maxLength: 10 }),
        (program) => {
          const initial = recorderSnapshot();
          const initialData = structuredClone(
            initial.state.play.element,
          ) as RecorderData;
          const expected = produce(initialData, (draft) => {
            runProgram(draft as unknown as RecorderData, program);
          });
          const recorded = recordMutation<RecorderData>(
            initial,
            elementAddress.capability,
            elementAddress.elementId,
            (draft) => {
              runProgram(draft as unknown as RecorderData, program);
            },
          );
          let applied = initial;
          for (const operation of recorded.ops) {
            applied = apply(applied, operation);
            integrity(applied);
          }

          expect(applied.state.play.element).toEqual(expected);
          expect(recorded.next.state.play.element).toEqual(expected);
          expect(checkSnapshotIntegrity(recorded.next)).toEqual({ ok: true });
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects older-generation operations after a generation bump", () => {
    fc.assert(
      fc.property(
        fc.record({
          after: fc.array(fc.integer({ min: -5, max: 5 }).filter((delta) => delta !== 0), {
            minLength: 1,
            maxLength: 5,
          }),
          before: fc.array(fc.integer({ min: -5, max: 5 }).filter((delta) => delta !== 0), {
            minLength: 1,
            maxLength: 5,
          }),
          fresh: fc.array(fc.integer({ min: -5, max: 5 }).filter((delta) => delta !== 0), {
            minLength: 1,
            maxLength: 5,
          }),
        }),
        ({ after, before, fresh }) => {
          let current = snapshot();
          let generation = 0;
          let nextMutationId = 0;
          const applyIncrement = (
            delta: number,
            operationGeneration: number,
            mutationId: number,
          ): boolean => {
            if (operationGeneration !== generation) return false;
            current = withLastMutationId(
              apply(current, {
                type: "increment",
                ...elementAddress,
                path: ["count"],
                delta,
              }),
              "client",
              mutationId,
            );
            return true;
          };

          for (const delta of before) {
            nextMutationId += 1;
            expect(applyIncrement(delta, 0, nextMutationId)).toBe(true);
          }
          generation = 1;
          const oldApplied = after.map((delta) => {
            nextMutationId += 1;
            return applyIncrement(delta, 0, nextMutationId);
          });
          const freshApplied = fresh.map((delta) => {
            nextMutationId += 1;
            return applyIncrement(delta, 1, nextMutationId);
          });
          const count = (current.state.play.element as { count: number }).count;
          expect(oldApplied.every(Boolean)).toBe(false);
          expect(freshApplied.every(Boolean)).toBe(true);
          expect(count).toBe(
            before.reduce((sum, delta) => sum + delta, 0) +
              fresh.reduce((sum, delta) => sum + delta, 0),
          );
          integrity(current);
        },
      ),
      { numRuns: 100 },
    );
  });
});
