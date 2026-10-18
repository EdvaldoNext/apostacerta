import { buildBillingMe } from "@/server/access";
import { json } from "@/server/http";
import { requireSession } from "@/server/session";

export async function GET(req: Request) {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  return json(await buildBillingMe(auth.user));
}
