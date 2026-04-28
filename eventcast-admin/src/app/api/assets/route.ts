export const runtime = 'edge';

export async function GET() {
  return Response.json({ success: false, message: "Route disabled. Reverted to Supabase fetch." });
}
