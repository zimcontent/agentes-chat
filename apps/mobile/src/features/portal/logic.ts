/**
 * The phone's approval portal (ADR 9001) to the rest of the app: whether it is on here (the tab bar asks) and the
 * pure rules its screens use (`model.ts`, tested on their own).
 */
export { usePortalOn } from "./hooks";
export * from "./model";
