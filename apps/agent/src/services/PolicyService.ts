import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const policyDir = join(dirname(fileURLToPath(import.meta.url)), "..", "policy");

export type PolicyTopic = "intake" | "escalation" | "appointment" | "communication";

const TOPIC_FILES: Record<PolicyTopic, string> = {
  intake: "intake-policy.md",
  escalation: "escalation-rules.md",
  appointment: "appointment-rules.md",
  communication: "communication-policy.md",
};







export class PolicyService {
  private readonly docs = new Map<PolicyTopic, string>();
  private readonly supportedCategories: { type: string; label: string }[];
  private readonly officeHours: Record<string, unknown>;

  constructor() {
    for (const [topic, file] of Object.entries(TOPIC_FILES) as [PolicyTopic, string][]) {
      this.docs.set(topic, readFileSync(join(policyDir, file), "utf-8"));
    }
    this.supportedCategories = JSON.parse(readFileSync(join(policyDir, "supported-case-categories.json"), "utf-8")).supported;
    this.officeHours = JSON.parse(readFileSync(join(policyDir, "office-hours.json"), "utf-8"));
  }

  getDoc(topic: PolicyTopic): string {
    return this.docs.get(topic) ?? "";
  }

  getDocs(topics: PolicyTopic[]): string {
    return topics.map((t) => this.getDoc(t)).join("\n\n");
  }

  getSupportedCategoriesText(): string {
    return this.supportedCategories.map((c) => `- ${c.label} (${c.type})`).join("\n");
  }

  getOfficeHoursText(): string {
    return JSON.stringify(this.officeHours);
  }
}
