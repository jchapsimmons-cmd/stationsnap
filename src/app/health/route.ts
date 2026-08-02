import { GET as healthCheck } from "@/app/api/health/route";

export const dynamic = "force-dynamic";
export const GET = healthCheck;
