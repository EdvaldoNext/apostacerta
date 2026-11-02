import { AppShell } from "@/components/AppShell";
import type { AuthUser } from "@/lib/types";
import { getSession } from "@/server/session";

export default async function HomePage() {
  let initialUser: AuthUser | null | undefined;
  try {
    const session = await getSession();
    initialUser = session?.user ?? null;
  } catch (error) {
    console.error("[page] session", error);
    initialUser = undefined;
  }
  return <AppShell initialUser={initialUser} />;
}
