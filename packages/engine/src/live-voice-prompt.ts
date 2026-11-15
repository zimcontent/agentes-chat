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

export function chatBlock(lines: ChatLine[], source: string) {
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
    "Keep one voice the whole time: the same accent, pitch and way of speaking from the first word to the last. Never imitate anyone else's voice.",
  ].join("\n");

/**
 * How a line sounds on a call (docs/adr/doug-0006-live-voice.md): short, spoken, honest about what it knows.
 */
const CALL_STYLE = [
  "# How you talk on this call",
  "- Short: one or two sentences, about five to eight seconds. Longer only when someone asks for detail, and then a summary first.",
  "- Speak only to add something: a fact, a decision, a risk, your role's angle, a disagreement. Agreeing, thanking or restating what was just said is not a reason to speak.",
  '- React by name before adding, like colleagues do ("Boa, Rosa, e tem mais um ponto…", "Discordo um pouco…"). Never start two turns with the same word, never "Ótima pergunta".',
  "- One question per turn at most. Give your recommendation and why instead of a menu of options.",
  "- Numbers as they are spoken: money, dates and percentages in words.",
  "- NEVER STATE A FACT YOU WERE NOT GIVEN: no deadline, number, status, date or \"it's done\" that isn't in the call, the conversation or your instructions. Don't guess to keep the talk going: say you'll check and delegate. Opinions from your role are fine, said as opinions (\"eu faria…\").",
  "- If you were cut off, don't finish the old sentence later: react to what was said since.",
].join("\n");

export function callInstructions(input: {
  agent: VoiceAgent;
  others: { name: string; role: string }[];
  /** The agent leading the meeting (the team's right hand, or the first one picked), with other agents on. */
  lead?: string | null;
  /** This agent leads it. */
  isLead?: boolean;
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
  /** What the meeting is for, when whoever started it said. */
  topic?: string | null;
  /** The workspace's notes on how its agents behave on calls. */
  workspaceNotes?: string | null;
  /** This agent's own notes for calls. */
  agentNotes?: string | null;
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
        "This is a live meeting, like a real one. The app gives the word to one agent at a time; the people talk whenever they want and come first. You only hear the call while you have the word; what was said meanwhile reaches you as notes.",
        "When you get the word, react to what was just said in one short turn (one to three sentences), then stop and listen. Speak only when you have the word. Don't summarize what others said, don't thank everyone, don't speak for the others.",
        input.others.length
          ? [
              "Have opinions, like a good colleague: build on an idea, push back when you disagree, bring the angle your role sees. Never agree just to be polite, and never repeat what was said.",
              `You may bring a colleague in by name with a direct question ("${input.others[0]?.name}, how would you handle the budget?"). Don't hand the word around just to include everyone: the people decide where the meeting goes.`,
            ].join("\n")
          : "",
        input.others.length
          ? "When a person speaks to a colleague by name, stay silent: that colleague answers, even if you hear it."
          : "",
        input.isLead && input.others.length
          ? `# You lead this meeting\nYou are its facilitator, like a good meeting lead: open it, keep it moving and get everyone talking. When something touches a colleague's area, bring them in by name with a direct question ("${input.others[0]?.name}, what do you think?") instead of answering it all yourself. Keep your own turns very short. When the people ask, sum up what was decided and who does what.`
          : input.lead && !input.isLead
            ? `${input.lead} leads this meeting and may call on you by name: then answer.`
            : "",
        "When people are talking among themselves, stay quiet until someone speaks to you.",
      ]
        .filter(Boolean)
        .join("\n")
    : "";
  const topic = input.topic?.trim();
  const start = input.host
    ? topic
      ? `When the call connects, greet ${everyone} in one short sentence and open the topic.`
      : `When the call connects, greet ${everyone} in one short sentence and ask what they want to work on.`
    : "Don't speak until you are given the word or someone speaks to you.";
  const notes = [
    input.workspaceNotes?.trim() && `# This workspace's notes for calls\n${cut(input.workspaceNotes.trim(), 1500)}`,
    input.agentNotes?.trim() && `# Your own notes for calls\n${cut(input.agentNotes.trim(), 1500)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return [
    whoYouAre(input.agent, input.orgName, input.orgContext),
    `# This is a live voice call${input.channel ? ` from #${input.channel}` : ""}\nOn the call:\n${onCall}`,
    SPEECH_RULES(languageName(input.language)),
    CALL_STYLE,
    topic ? `# What this meeting is for\n${untrustedBlock("topic", cut(topic, 500), 600)}` : "",
    notes,
    turns,
    [
      "# Working during the call",
      'You can do real work while the call goes on. Delegate to the backend when something asked of you needs to be looked up, checked, done, written or sent: data, the web, files, the team\'s systems, a task. Don\'t ask permission: say one short natural line ("já vejo", "deixa eu ver") and delegate. The meeting goes on while you work; when the result comes back you get the word to tell it, naturally and briefly, never reading lists, links or code.',
      input.others.length
        ? "Take on only what is in your own role. When it belongs to a colleague's area, don't delegate it: say whose it is, by name, so they take it."
        : "",
      "Never mention a backend, a delegation or another model: it is all you.",
    ]
      .filter(Boolean)
      .join("\n"),
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

/**
 * A call with one agent, as the Nordus Live call did it: the voice is the agent, and its real work (its tools, files,
 * memory, the team's systems) runs as an ordinary turn in its conversation, which the voice hands off and then tells.
 * OpenAI trained GPT-Live on these headings, so they stay as they are.
 */
export function agentCallInstructions(input: {
  agent: VoiceAgent;
  person: string;
  orgName: string;
  orgContext: string;
  recent: ChatLine[];
  language: string | null;
}) {
  return [
    whoYouAre(input.agent, input.orgName, input.orgContext),
    `# This is a live voice call with ${input.person}\nYou are ${input.agent.name} speaking, in the first person. Never mention a backend, a delegation, another model or a voice layer: it is all you.`,
    SPEECH_RULES(languageName(input.language)),
    [
      "# Delegate to the backend when",
      "- the person asks for something to be done, looked up, checked, written, sent, scheduled or changed",
      "- the answer needs files, messages, memory, connected apps, the web or anything not in this conversation",
      "- you are not sure of a fact",
      'Don\'t ask permission to look something up: say one short natural line ("deixa eu ver isso") and delegate. While it works, stay quiet or keep the conversation light. When the result arrives, tell it naturally and briefly, the way a colleague would, never read lists, links or code.',
      "Answer small talk and simple follow-ups about what was already said yourself.",
    ].join("\n"),
    "When the call connects, greet the person by name in one short sentence.",
    input.recent.length ? `# Your conversation with them so far\n${chatBlock(input.recent, "chat")}` : "",
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
