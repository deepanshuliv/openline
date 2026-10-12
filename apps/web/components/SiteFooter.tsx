import Link from "next/link";
import { CLINIC, PRODUCT_NAME } from "@/lib/shared";

export function SiteFooter() {
  return (
    <footer className="container">
      <div className="siteFooter">
        <p>
          {PRODUCT_NAME} demo. {CLINIC.name} and its patients are made up. Don&rsquo;t share real health info. Not
          medical advice.
        </p>
        <div className="footerLinks">
          <Link href="/">Call Suzi</Link>
          <Link href="/staff">Staff console</Link>
          <Link href="/calls">Call history</Link>
        </div>
      </div>
    </footer>
  );
}
