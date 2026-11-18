import type { AgentesModule } from "@agenteschat/modules";

/**
 * A client's own code (ADR doug-0020), loaded at boot only for the server whose `DOUG_CLIENT_CODE` is this folder's.
 * This one is the example every new client starts from: it shows what an `AgentesModule` may add, and it is the one
 * the tests load. A client that needs nothing beyond the declarative `config.json` leaves this file out.
 */
const exemplo: AgentesModule = {
  name: "client-000-exemplo",
  onStart() {
    // Runs once the server is listening, with the module's context (`config`, `db`, `adapters`, `edition`, `version`).
    // It may only extend through this API: a client never reaches into the engine's globals, and never changes what the
    // product does for everyone. Work that turns out to be good for every client moves out of `clients/` into the
    // shared code (ADR doug-0020 §4), leaving at most a line here.
  },
};

export default exemplo;
