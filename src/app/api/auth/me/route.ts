import { json } from "@/server/http";
import { getSession, renewSessionIfNeeded } from "@/server/session";

export async function GET(req: Request) {
  try {
    const session = await getSession(req);
    if (!session) return json({ user: null });
    await renewSessionIfNeeded(session);
    return json({ user: session.user });
  } catch (error) {
    console.error("[me]", error);
    return json({ user: null });
  }
}
