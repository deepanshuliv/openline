import {
  AgentName,
  CallPhase,
  REQUIRED_INTAKE_FIELDS,
  TurnState,
  type CallerContact,
  type IntakeFields,
  type QualificationStatus,
} from "@repo/shared";

const RECENT_USER_TURN_WINDOW = 6;






export class CallState {
  callId: string;
  roomName: string;
  callerId: string | null = null;
  matterId: string | null = null;
  currentPhase: CallPhase = CallPhase.GREETING;
  activeAgent: AgentName = AgentName.TRIAGE;
  turnState: TurnState = TurnState.LISTENING;

  callerContact: CallerContact = {};
  collectedFields: IntakeFields = {};
  qualificationStatus: QualificationStatus | null = null;

  conversationSummary: string | null = null;
  lastUserTurn: string | null = null;
  pendingAction: string | null = null;

  interruptionCount = 0;






  pendingExtraction: Promise<void> | null = null;







  readonly recentUserTurns: string[] = [];

  pushRecentUserTurn(text: string): void {
    this.recentUserTurns.push(text);
    if (this.recentUserTurns.length > RECENT_USER_TURN_WINDOW) {
      this.recentUserTurns.shift();
    }
  }

  constructor(params: { callId: string; roomName: string }) {
    this.callId = params.callId;
    this.roomName = params.roomName;
  }


  get missingRequiredFields(): string[] {
    return REQUIRED_INTAKE_FIELDS.filter((field) => {
      const value = this.collectedFields[field];
      if (Array.isArray(value)) return value.length === 0;
      return value === undefined || value === null || value === "";
    });
  }

  mergeIntakeFields(fields: Partial<IntakeFields>): string[] {
    const updated: string[] = [];
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      (this.collectedFields as Record<string, unknown>)[key] = value;
      updated.push(key);
    }
    return updated;
  }
}
