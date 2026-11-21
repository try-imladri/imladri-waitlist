import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/waitlist/auth";
import { adminAccessResponse } from "@/lib/waitlist/access";

export async function getAdminPageUser() {
  const requestHeaders=await headers();
  const localHost=requestHeaders.get("host")||"";
  const localOrigin=import.meta.env.DEV&&/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(localHost)?`http://${localHost}`:null;
  const origin=localOrigin||env.PUBLIC_APP_URL||env.SITE_BASE_URL||"http://127.0.0.1:5173";
  const request=new Request(new URL("/admin",origin),{headers:new Headers(requestHeaders)});
  if(await adminAccessResponse(request,env))redirect("/");
  return getAdminSession(request,env,import.meta.env.DEV);
}

export async function requireAdminPage() {
  const user=await getAdminPageUser();
  if(!user)redirect("/admin");
  return user;
}
