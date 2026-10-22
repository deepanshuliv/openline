import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

// Every page in this group needs a signed-in user; signed-out visitors go to
// /sign-in. The home page and /sign-in live outside the group: home is public,
// and asks for sign-in only when the visitor presses Call Suzi.
export default async function SignedInLayout({ children }: { children: ReactNode }) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  return children;
}
