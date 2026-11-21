import { env } from "cloudflare:workers";
import { handleApi } from "@/lib/waitlist/handlers";
import { deferRequestWork } from "@/lib/waitlist/request-context";

export const dynamic = "force-dynamic";
export function GET(request:Request){return handleApi(request,env,import.meta.env.DEV,fetch,deferRequestWork);}
export function POST(request:Request){return handleApi(request,env,import.meta.env.DEV,fetch,deferRequestWork);}
export function DELETE(request:Request){return handleApi(request,env,import.meta.env.DEV);}
export function PUT(request:Request){return handleApi(request,env,import.meta.env.DEV);}
