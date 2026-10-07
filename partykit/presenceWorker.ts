// ABOUTME: Routes local development traffic to the volatile PresenceServer only.
// ABOUTME: Keeps presence verification independent from persisted PartyServer configuration.
import { routePartykitRequest } from "partyserver";

export { PresenceServer } from "./presenceServer";

type PresenceWorkerEnv = Pick<Env, "Presence">;

export default {
  async fetch(
    request: Request,
    workerEnv: PresenceWorkerEnv,
  ): Promise<Response> {
    // PartyServer types its router against the generated production Env. This
    // entry intentionally exposes only the Presence Durable Object binding.
    return (
      (await routePartykitRequest(request, workerEnv as Env)) ??
      new Response("Not Found", { status: 404 })
    );
  },
} satisfies ExportedHandler<PresenceWorkerEnv>;
