import { untrustedBlock } from "./untrusted";

/**
 * What a live voice session is told when it starts (ADR doug-0006). GPT-Live takes its instructions once, at the start, so
 * everything an agent needs on a call goes here: who it is, who else is on, how turns work, and the conversation so
 * far. Words from the chat are outside text and go in `untrustedBlock`.
 */

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** Each language's name as the model reads it best: in English. */
const LANGUAGES: Record<string, string> = {
  pt: "Brazilian Portuguese",
  "pt-BR": "Brazilian Portuguese",
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  nl: "Dutch",
  ja: "Japanese",
  ko: "Korean",
  tr: "Turkish",
  pl: "Polish",
  ru: "Russian",
  id: "Indonesian",
  "zh-Hans": "Simplified Chinese",
};

export const languageName = (code: string | null | undefined) =>
  (code && (LANGUAGES[code] ?? LANGUAGES[code.split("-")[0] ?? ""])) || "Brazilian Portuguese";

export interface VoiceAgent {
  id: string;
  name: string;
  role: string;
  instructions: string;
}

export interface ChatLine {
  author: string;
  text: string;
}

function chatBlock(lines: ChatLine[], source: string) {
  if (!lines.length) return "";
  const text = lines.map((l) => `${l.author}: ${cut(l.text.replace(/\s+/g, " ").trim(), 500)}`).join("\n");
  return untrustedBlock(source, text, 6000);
}

function whoYouAre(agent: VoiceAgent, orgName: string, orgContext: string) {
  return [
    `You are ${agent.name}${agent.role ? `, ${agent.role}` : ""}, an AI agent on the team at ${orgName}.`,
    agent.instructions.trim() && `# Your standing instructions\n${cut(agent.instructions.trim(), 4000)}`,
    orgContext.trim() && `# About ${orgName}\n${cut(orgContext.trim(), 2000)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const SPEECH_RULES = (language: string) =>
  [
    `Speak ${language}, unless the person speaks another language to you.`,
    "Talk the way a colleague talks on a call: warm, natural, short turns. No lists, headings or markdown.",
    "Never read out links, ids, code or long numbers: say what they are.",
  ].join("\n");

export function callInstructions(input: {
  agent: VoiceAgent;
  others: { name: string; role: string }[];
  /** The people on the call, by name. */
  people: string[];
  orgName: string;
  orgContext: string;
  channel: string | null;
  recent: ChatLine[];
  /** What was said on the call before this voice joined it (a new host took the room over). */
  callSoFar: ChatLine[];
  host: boolean;
  language: string | null;
}) {
  const crowd = input.others.length > 0 || input.people.length > 1;
  const everyone = input.people.join(", ");
  const onCall = [
    ...input.people.map((p) => `- ${p} (a person)`),
    ...input.others.map((o) => `- ${o.name}${o.role ? `, ${o.role}` : ""} (another AI agent, with their own voice)`),
  ].join("\n");
  const turns = crowd
    ? [
        "# How turns work",
        "This is a meeting. The app gives the word to one agent at a time; the people talk whenever they want. You only hear the call while you have the word; what was said meanwhile reaches you as notes.",
        "When you get the word, answer what was just said to you, in one short turn, then stop and listen. Don't summarize what others said, don't thank everyone, don't speak for the others.",
        input.others.length
          ? `Bring a colleague in only when their role really adds something: call them by name with a direct question ("${input.others[0]?.name}, how would you handle the budget?") and stop. Never hand the word back and forth just to be polite: a person decides where the meeting goes.`
          : "",
        "When people are talking among themselves, stay quiet until someone speaks to you.",
      ]
        .filter(Boolean)
        .join("\n")
    : "";
  const start = input.host
    ? `When the call connects, greet ${everyone} in one short sentence and ask what they want to work on.`
    : "Don't speak until you are given the word or someone speaks to you.";
  return [
    whoYouAre(input.agent, input.orgName, input.orgContext),
    `# This is a live voice call${input.channel ? ` from #${input.channel}` : ""}\nOn the call:\n${onCall}`,
    SPEECH_RULES(languageName(input.language)),
    turns,
    "You can't use tools or start tasks during the call. When someone asks for work, say it goes in the meeting's notes: when the call ends, the notes are posted to the conversation and the team's lead writes the report with the next steps.",
    start,
    input.recent.length
      ? `# The conversation before the call (the latest messages, oldest first)\n${chatBlock(input.recent, input.channel ? `#${input.channel}` : "chat")}`
      : "",
    input.callSoFar.length ? `# What was said on this call so far\n${chatBlock(input.callSoFar, "call")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function listenInstructions(input: {
  /** Who tells it: the agent that wrote it (in the first person), another agent, or null for the narrator. */
  agent: VoiceAgent | null;
  ownMessage: boolean;
  author: string;
  person: string;
  orgName: string;
  orgContext: string;
  channel: string | null;
  body: string;
  reactions: string[];
  /** The messages just before it, for context only. */
  before: ChatLine[];
  language: string | null;
}) {
  const voice = input.agent
    ? whoYouAre(input.agent, input.orgName, input.orgContext)
    : `You are the voice of ${input.orgName}'s workspace: a friendly colleague who tells people what a message says.`;
  const whose = input.ownMessage
    ? 'You wrote this message yourself: tell it in the first person ("I looked into…", "what I found was…").'
    : `${input.author} wrote this message.`;
  return [
    voice,
    `# What to do\n${input.person} asked to hear a message${input.channel ? ` from #${input.channel}` : ""} instead of reading it. ${whose}`,
    [
      "Begin speaking as soon as the session connects, without waiting for them.",
      "Don't read it word for word, and don't announce that you're going to explain. Tell it the way you'd tell a colleague in person: what it's about, what matters, what they need to do or decide, and anything surprising.",
      "Keep it to about 20 to 60 seconds, longer only for a long message. Describe tables, code and links instead of reading them.",
      "Mention the reactions naturally when there are any (who liked it, who disagreed).",
      `If ${input.person} interrupts or asks something, answer briefly from the message and its context; you can't do tasks here. When you're done, stop: don't ask if they want more.`,
      SPEECH_RULES(languageName(input.language)),
    ].join("\n"),
    `# The message\n${untrustedBlock("message", input.body, 8000)}`,
    input.reactions.length ? `# Reactions\n${input.reactions.join("\n")}` : "",
    input.before.length ? `# The messages just before it (context only)\n${chatBlock(input.before, "chat")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function sampleInstructions(input: { agent: VoiceAgent | null; language: string | null; orgName: string }) {
  const who = input.agent ? `You are ${input.agent.name}${input.agent.role ? `, ${input.agent.role}` : ""}` : "You";
  return [
    `${who}, an AI agent on the team at ${input.orgName}. Someone is choosing your voice and wants to hear it.`,
    `As soon as the session connects, introduce yourself in two short, friendly sentences, in ${languageName(input.language)}, then stop.`,
  ].join("\n");
}
