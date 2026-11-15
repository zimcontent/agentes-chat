import InCallManager from "react-native-incall-manager";

/**
 * Where a call's sound goes on the phone (docs/adr/doug-0006-live-voice.md, the phone app): the earpiece, as a phone
 * call ("modo telefone", the default), with the proximity sensor turning the screen off at the ear; or the loudspeaker
 * ("viva voz"). A headset plugged in or paired takes it on its own. The call's audio session (voice processing, the
 * system's echo cancelling) lasts from `start` to `stop`.
 */

export type CallRoute = "earpiece" | "speaker";

let on = false;

export function startCallAudio(route: CallRoute) {
  if (!on) {
    on = true;
    InCallManager.start({ media: "audio" });
    InCallManager.setKeepScreenOn(true);
  }
  setCallRoute(route);
}

export function setCallRoute(route: CallRoute) {
  if (!on) return;
  InCallManager.setForceSpeakerphoneOn(route === "speaker");
  // At the ear the screen goes dark (no cheek taps); on the loudspeaker the phone is in the hand or on the table.
  if (route === "speaker") InCallManager.stopProximitySensor();
  else InCallManager.startProximitySensor();
}

export function stopCallAudio() {
  if (!on) return;
  on = false;
  InCallManager.stopProximitySensor();
  InCallManager.setKeepScreenOn(false);
  InCallManager.stop();
}
