import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

// Every page in this group needs a signed-in user; signed-out visitors go to
// /sign-in. Only /sign-in lives outside the group.
export default async function SignedInLayout({ children }: { children: ReactNode }) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  return children;
}
