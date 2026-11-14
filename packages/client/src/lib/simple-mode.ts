import type { OrgSummary } from "../api/types";

/**
 * Whether this person's screens stay simple: no code, no tool names, no raw values a tool got or gave, only what an
 * agent did and wants to do, in words. One choice for how agents talk and what the screens show (`agentStyle`):
 * simple unless the person picked "technical".
 */
export const simpleScreens = (org: Pick<OrgSummary, "agentStyle">) => org.agentStyle !== "technical";
