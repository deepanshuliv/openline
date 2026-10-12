// A call's status as a dot and a word, the same in the history list and on the call record.
const STATUS_DOT: Record<string, string> = {
  ACTIVE: "pulse",
  COMPLETED: "",
  HANDED_OFF: "pending",
  ERROR: "off",
};

export function CallStatus({ status }: { status: string }) {
  return (
    <span className="statusText">
      <span className={`liveDot ${STATUS_DOT[status] ?? "off"}`} aria-hidden="true" />
      {status.toLowerCase().replace("_", " ")}
    </span>
  );
}
