"use client";

import { useEffect, useState } from "react";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent } from "livekit-client";
import { SpeakerHigh } from "@phosphor-icons/react";

// Browsers block autoplay until the page gets a user gesture; offer one.
export function AudioUnblocker() {
  const room = useRoomContext();
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const sync = () => setBlocked(!room.canPlaybackAudio);
    sync();
    room.on(RoomEvent.AudioPlaybackStatusChanged, sync);
    return () => {
      room.off(RoomEvent.AudioPlaybackStatusChanged, sync);
    };
  }, [room]);

  if (!blocked) return null;

  return (
    <button type="button" className="btn btn-secondary" onClick={() => void room.startAudio()}>
      <SpeakerHigh size={16} weight="regular" aria-hidden="true" />
      Enable sound
    </button>
  );
}
