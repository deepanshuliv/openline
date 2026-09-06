import type { Agent } from "@livekit/agents";
import {
  AgentName,
  CallEventType,
  CallPhase,
  createLogger,
  evaluateQualification,
  isTransitionAllowed,
  type QualificationResult,
} from "@repo/shared";
import { AppointmentService } from "../services/AppointmentService.js";
import { CaseService } from "../services/CaseService.js";
import { CallLogService } from "../services/CallLogService.js";
import { EventService } from "../services/EventService.js";
import { OpenRouterService } from "../services/OpenRouterService.js";
import { PolicyService } from "../services/PolicyService.js";
import { ToolRegistry } from "../tools/ToolRegistry.js";
import { CallState } from "./CallState.js";
import { ContextService } from "./ContextService.js";
import { createTriageAgent } from "../agents/TriageAgent.js";
import { createIntakeAgent } from "../agents/IntakeAgent.js";
import { createQualificationAgent } from "../agents/QualificationAgent.js";
import { createSchedulingAgent } from "../agents/SchedulingAgent.js";

const logger = createLogger("agent:orchestrator");

const PHASE_FOR_AGENT: Record<AgentName, CallPhase> = {
  [AgentName.TRIAGE]: CallPhase.TRIAGE,
  [AgentName.INTAKE]: CallPhase.INTAKE,
  [AgentName.QUALIFICATION]: CallPhase.QUALIFICATION,
  [AgentName.SCHEDULING]: CallPhase.SCHEDULING,
};

const AGENT_FACTORIES: Record<AgentName, (o: CallOrchestrator) => Agent> = {
  [AgentName.TRIAGE]: createTriageAgent,
  [AgentName.INTAKE]: createIntakeAgent,
  [AgentName.QUALIFICATION]: createQualificationAgent,
  [AgentName.SCHEDULING]: createSchedulingAgent,
};









export class CallOrchestrator {
  readonly state: CallState;
  readonly eventService: EventService;
  readonly caseService = new CaseService();
  readonly appointmentService = new AppointmentService();
  readonly callLogService = new CallLogService();
  readonly openRouterService = new OpenRouterService();
  readonly policyService = new PolicyService();
  readonly contextService: ContextService;
  readonly tools: ToolRegistry;

  private ended = false;






  onEnded: (() => void) | null = null;

  constructor(params: { callId: string; roomName: string }) {
    this.state = new CallState(params);
    this.eventService = new EventService(params.callId);
    this.contextService = new ContextService(this.policyService);
    this.tools = new ToolRegistry({
      state: this.state,
      eventService: this.eventService,
      caseService: this.caseService,
      appointmentService: this.appointmentService,
      callLogService: this.callLogService,
      onEndCall: (reason, summary) => this.endCall(reason, summary),
    });
  }

  async start(): Promise<void> {
    await this.eventService.emit(CallEventType.CALL_STARTED, { phase: this.state.currentPhase, metadata: { roomName: this.state.roomName } });
    this.transitionPhase(CallPhase.TRIAGE, "call started");
  }


  transitionPhase(next: CallPhase, reason: string): boolean {
    if (!isTransitionAllowed(this.state.currentPhase, next)) {
      logger.warn("phase.transition_rejected", { from: this.state.currentPhase, to: next, reason });
      return false;
    }
    const from = this.state.currentPhase;
    this.state.currentPhase = next;
    void this.eventService.emit(CallEventType.PHASE_CHANGED, {
      agent: this.state.activeAgent,
      phase: next,
      metadata: { from, to: next, reason },
    });
    return true;
  }







  prepareHandoff(target: AgentName): { agent: Agent; phaseChanged: boolean } | null {
    const targetPhase = PHASE_FOR_AGENT[target];
    const phaseChanged = this.transitionPhase(targetPhase, `handoff to ${target}`);
    if (!phaseChanged && this.state.currentPhase !== targetPhase) {
      return null;
    }
    const previousAgent = this.state.activeAgent;
    this.state.activeAgent = target;
    void this.eventService.emit(CallEventType.AGENT_HANDOFF, {
      agent: target,
      phase: this.state.currentPhase,
      metadata: { from: previousAgent, to: target },
    });
    const agent = AGENT_FACTORIES[target](this);
    return { agent, phaseChanged };
  }

  buildInitialAgent(): Agent {
    this.state.activeAgent = AgentName.TRIAGE;
    void this.eventService.emit(CallEventType.AGENT_ENTERED, { agent: AgentName.TRIAGE, phase: this.state.currentPhase });
    return createTriageAgent(this);
  }


  async runQualification(): Promise<QualificationResult> {



    if (this.state.pendingExtraction) {
      await this.state.pendingExtraction;
    }
    const result = evaluateQualification({
      incidentType: this.state.collectedFields.incidentType,
      incidentDate: this.state.collectedFields.incidentDate,
      injuries: this.state.collectedFields.injuries,
      representedByAttorney: this.state.collectedFields.representedByAttorney,
    });
    this.state.qualificationStatus = result.status;
    if (this.state.matterId) {
      await this.caseService.setQualificationStatus(this.state.matterId, result.status);
    }
    await this.eventService.emit(CallEventType.PHASE_CHANGED, {
      agent: AgentName.QUALIFICATION,
      phase: this.state.currentPhase,
      metadata: { qualificationStatus: result.status, reasons: result.reasons },
    });
    return result;
  }

  async recordUserTurn(text: string) {
    if (!text.trim()) return;
    this.state.lastUserTurn = text;
    this.state.pushRecentUserTurn(text);
    await this.callLogService.addTranscriptTurn(this.state.callId, "CALLER", text);
    this.scheduleExtraction();
  }









  private scheduleExtraction(): void {
    this.state.pendingExtraction = this.extractAndPersist().finally(() => {
      this.state.pendingExtraction = null;
    });
  }

  private async extractAndPersist(): Promise<void> {
    try {
      const { fields, durationMs } = await this.openRouterService.extractIntakeFields({
        conversationExcerpt: this.state.recentUserTurns.map((t) => `caller: ${t}`).join("\n"),
        alreadyKnown: this.state.collectedFields,
      });

      const updatedKeys = this.state.mergeIntakeFields(fields);
      if (updatedKeys.length === 0) return;

      if (this.state.matterId) {
        await this.caseService.updateIntake(this.state.matterId, fields);
      }
      await this.eventService.emit(CallEventType.INTAKE_FIELDS_EXTRACTED, {
        agent: this.state.activeAgent,
        phase: this.state.currentPhase,
        durationMs,
        metadata: { updatedFields: updatedKeys, values: fields as Record<string, unknown> },
      });
    } catch (err) {


      await this.eventService.emit(CallEventType.ERROR, {
        agent: this.state.activeAgent,
        phase: this.state.currentPhase,
        metadata: { message: err instanceof Error ? err.message : String(err), source: "intake_extraction" },
      });
    }
  }

  async recordAgentTurn(text: string) {
    if (!text.trim()) return;
    await this.callLogService.addTranscriptTurn(this.state.callId, "AGENT", text);
  }

  async endCall(reason: string, summary?: string | null): Promise<void> {
    if (this.ended) return;
    this.ended = true;

    let finalSummary = summary?.trim() || null;
    if (!finalSummary) {
      const transcriptExcerpt = await this.callLogService.getRecentTranscript(this.state.callId);
      finalSummary = (await this.openRouterService.summarizeCall({ transcriptExcerpt, fields: this.state.collectedFields })) || null;
    }



    if (!isTransitionAllowed(this.state.currentPhase, CallPhase.COMPLETED) && isTransitionAllowed(this.state.currentPhase, CallPhase.CONFIRMATION)) {
      this.transitionPhase(CallPhase.CONFIRMATION, `${reason} (bridging to confirmation)`);
    }
    this.transitionPhase(CallPhase.COMPLETED, reason);
    await this.callLogService.endCall(this.state.callId, { status: "COMPLETED", finalSummary: finalSummary ?? undefined });
    await this.eventService.emit(CallEventType.CALL_ENDED, {
      phase: CallPhase.COMPLETED,
      metadata: { reason, summary: finalSummary },
    });
    this.onEnded?.();
  }
}
