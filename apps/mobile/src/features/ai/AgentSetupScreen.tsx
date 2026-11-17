import { openAgentSettings } from "../agents/elsewhere";

/*
 * "Usar em outros agentes" left the phone with the rest of the agents' setup: from "Pensa com" it opens the agent's
 * light settings, whose "Mais ajustes no site" and "Pedir ao Doug" reach it.
 */
export const openAgentSetup = (agentId: string) => openAgentSettings(agentId);
