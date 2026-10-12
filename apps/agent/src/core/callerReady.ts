import { RoomEvent, type Participant, type Room } from "@livekit/rtc-node";
import { CALLER_READY_ATTRIBUTE } from "@repo/shared";

// Resolves true once the caller sets CALLER_READY_ATTRIBUTE (they pressed OK in
// the browser), or false if they leave or don't confirm within `timeoutMs`.
export function waitForCallerReady(room: Room, identity: string, timeoutMs: number): Promise<boolean> {
  const isReady = (p: Participant | undefined) => p?.attributes[CALLER_READY_ATTRIBUTE] === "true";
  if (isReady(room.remoteParticipants.get(identity))) return Promise.resolve(true);

  return new Promise((resolve) => {
    const finish = (ready: boolean) => {
      clearTimeout(timer);
      room.off(RoomEvent.ParticipantAttributesChanged, onAttributes);
      room.off(RoomEvent.ParticipantDisconnected, onLeft);
      resolve(ready);
    };
    const onAttributes = (_changed: Record<string, string>, p: Participant) => {
      if (p.identity === identity && isReady(p)) finish(true);
    };
    const onLeft = (p: Participant) => {
      if (p.identity === identity) finish(false);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    room.on(RoomEvent.ParticipantAttributesChanged, onAttributes);
    room.on(RoomEvent.ParticipantDisconnected, onLeft);
  });
}
