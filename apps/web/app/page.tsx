import Link from "next/link";
import { CallConsole } from "@/components/CallConsole";

export default function HomePage() {
  return (
    <main className="page">
      <div className="topbar">
        <div className="brand">
          <h1>Gideon-style Intake Demo</h1>
          <span className="tag">voice AI orchestrator</span>
        </div>
        <nav className="nav">
          <Link href="/">Live Call</Link>
          <Link href="/calls">Call History</Link>
        </nav>
      </div>

      <CallConsole />
    </main>
  );
}
