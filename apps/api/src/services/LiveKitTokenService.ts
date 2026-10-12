import { AccessToken } from "livekit-server-sdk";
import { env } from "../env.js";

export interface MintedSession {
  roomName: string;
  identity: string;
  token: string;
  url: string;
}

export class LiveKitTokenService {
  async createSession(params: { roomName: string; identity: string; participantName?: string; canSetAttributes?: boolean }): Promise<MintedSession> {
    const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
      identity: params.identity,
      name: params.participantName ?? params.identity,
      ttl: "30m",
    });
    at.addGrant({
      room: params.roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      // The caller marks itself ready (CALLER_READY_ATTRIBUTE) through its own attributes.
      canUpdateOwnMetadata: params.canSetAttributes ?? false,
    });
    const token = await at.toJwt();
    return { roomName: params.roomName, identity: params.identity, token, url: env.LIVEKIT_URL };
  }
}
