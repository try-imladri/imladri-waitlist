import { getAdminPageUser } from "@/lib/admin-auth";
import { AdminDashboard } from "@/components/waitlist/admin";
import { AdminLogin } from "@/components/waitlist/admin-login";

export const metadata = { title: "Owner dashboard", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export default async function AdminPage() {
  const user = await getAdminPageUser();
  if (!user) return <AdminLogin />;
  return <AdminDashboard ownerEmail={user.email} />;
}
