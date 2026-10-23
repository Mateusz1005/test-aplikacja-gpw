import "server-only";

import { NextResponse } from "next/server";
import { requireActiveAccess } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ forecastId: string }> },
) {
  const { forecastId } = await params;
  if (!uuidPattern.test(forecastId)) {
    return NextResponse.json({ error: "Nie znaleziono dokumentu." }, { status: 404 });
  }

  const { supabase, user } = await requireActiveAccess();
  const { data: forecast, error: forecastError } = await supabase
    .from("user_analyst_forecasts")
    .select("owner_id, storage_path, original_file_name")
    .eq("id", forecastId)
    .maybeSingle();

  if (forecastError) {
    throw forecastError;
  }
  if (!forecast) {
    return NextResponse.json({ error: "Nie znaleziono dokumentu." }, { status: 404 });
  }

  const { data: role, error: roleError } = await supabase
    .from("user_roles")
    .select("access_role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (roleError) {
    throw roleError;
  }
  if (role?.access_role === "admin" && forecast.owner_id !== user.id) {
    const { error: auditError } = await createAdminClient()
      .from("admin_audit_log")
      .insert({
        actor_id: user.id,
        target_user_id: forecast.owner_id,
        action: "private_forecast.download",
        details: { forecast_id: forecastId },
      });
    if (auditError) {
      throw auditError;
    }
  }

  const { data, error } = await createAdminClient()
    .storage
    .from("analyst-forecasts")
    .createSignedUrl(forecast.storage_path, 60, {
      download: forecast.original_file_name,
    });

  if (error) {
    throw error;
  }

  return NextResponse.redirect(data.signedUrl);
}
