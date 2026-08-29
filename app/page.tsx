import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Dashboard } from "@/components/dashboard";
import { getStore } from "@/lib/store";
import { SESSION_COOKIE, verifySession } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const jar = await cookies();
  if (!(await verifySession(jar.get(SESSION_COOKIE)?.value))) redirect("/login");
  const snapshot = await getStore().getSnapshot();
  return <Dashboard initialSnapshot={snapshot} />;
}

