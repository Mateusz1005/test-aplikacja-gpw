import "server-only";

import { NextResponse } from "next/server";
import { requireActiveAccess } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const { documentId } = await params;
  if (!uuidPattern.test(documentId)) {
    return NextResponse.json({ error: "Nie znaleziono dokumentu." }, { status: 404 });
  }

  const { supabase } = await requireActiveAccess();
  const { data: document, error: documentError } = await supabase
    .from("company_documents")
    .select("storage_path, original_file_name")
    .eq("id", documentId)
    .maybeSingle();

  if (documentError) {
    throw documentError;
  }
  if (!document?.storage_path) {
    return NextResponse.json({ error: "Nie znaleziono dokumentu." }, { status: 404 });
  }

  const { data, error } = await createAdminClient()
    .storage
    .from("company-reports")
    .createSignedUrl(document.storage_path, 60, {
      download: document.original_file_name ?? true,
    });

  if (error) {
    throw error;
  }

  return NextResponse.redirect(data.signedUrl);
}
