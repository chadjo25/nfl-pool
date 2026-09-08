/* app/login/page.tsx */
import LoginClient from "./LoginClient";

export const dynamic = "force-dynamic";

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  return <LoginClient reason={reason ?? null} />;
}
