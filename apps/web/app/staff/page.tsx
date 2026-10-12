import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { StaffConsole } from "@/components/StaffConsole";

export default function StaffPage() {
  return (
    <>
      <SiteNav />
      <main className="container">
        <StaffConsole />
      </main>
      <SiteFooter />
    </>
  );
}
