import { SignIn } from "@clerk/nextjs";
import { Wordmark } from "@/components/SiteNav";
import { Ribbon } from "@/components/Ribbon";
import { AGENT_NAME } from "@/lib/shared";

// The one page a signed-out visitor can see (proxy.ts sends everyone else here).
// Same frame as home: wordmark, serif headline, then the ribbon underneath.
export default function SignInPage() {
  return (
    <div className="signInPage">
      <header className="container">
        <div className="siteNav">
          <span className="wordmark">
            <Wordmark />
          </span>
        </div>
      </header>
      <main className="signInMain">
        <div className="container signInInner">
          <span className="eyebrow">Sign in to continue</span>
          <h1 className="h1">Talk to {AGENT_NAME}</h1>
          <p className="lede">Sign in to start a one-minute demo call with {AGENT_NAME}, our AI receptionist.</p>
          <SignIn routing="path" path="/sign-in" withSignUp />
        </div>
        <Ribbon />
      </main>
    </div>
  );
}
