# doug-0008: the number's agent sends a GIF now and then

Status: accepted. This instance's own. Extends doug-0002; voice notes are in doug-0004's addendum of 2026-11-15.

## Context

On WhatsApp people react with a GIF when something is funny or worth celebrating. An agent that only writes doesn't
talk like the people it talks to.

## Decision

**The answer may carry a GIF.** Besides `action`, `messages`, `note` and `voice`, the model may answer `gif`: a few
words to search one. The system prompt offers it only when GIF search is on and the agent sent none in that
conversation in the last 30 minutes (`WHATSAPP_GIF_EVERY_MINUTES`): rarely, never on a complaint, a charge, a delay,
something delicate or someone's first message. When it isn't offered, a `gif` the model writes anyway is dropped.

**The server finds and sends it.** The first result of the search, rated `g`, that GIPHY has as an MP4
(`GifProvider.video`) goes after the messages, as a video with `gifPlayback`: WhatsApp plays a GIF only that way.
A gateway that doesn't know the field sends an ordinary short video. Nothing found, or a send that fails, sends
nothing: a GIF is never the answer itself. It is kept as the agent's video message, which is what the 30 minutes
count.

## Consequences

The search words go to GIPHY, as the app's GIF search already sends them. A server without GIF search behaves as
before.
