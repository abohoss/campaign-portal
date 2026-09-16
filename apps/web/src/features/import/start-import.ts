import { z } from "zod";
import { supabase } from "@/lib/supabase.js";

export const importFormSchema = z.object({
  kind: z.enum(["contacts", "campaigns"]),
  file: z
    .instanceof(File)
    .refine((f) => f.size > 0, "File is empty")
    .refine((f) => f.size <= 50 * 1024 * 1024, "File is larger than 50MB")
    .refine((f) => f.name.toLowerCase().endsWith(".csv"), "Only .csv files are accepted"),
});

/**
 * Uploads the file to the private `imports` bucket, then calls import-start. The Storage RLS
 * policy (imports_owner_upload) independently re-checks that the caller is an owner of brandId —
 * this function's own role check is UX (show a clear error fast), not the security boundary.
 */
export async function startImport(brandId: string, kind: "contacts" | "campaigns", file: File): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not signed in");

  const storagePath = `${brandId}/${Date.now()}-${file.name}`;
  const { error: uploadError } = await supabase.storage.from("imports").upload(storagePath, file, {
    contentType: "text/csv",
  });
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  const { data, error } = await supabase.functions.invoke("import-start", {
    body: { brandId, kind, filename: file.name, storagePath },
  });
  if (error) throw new Error(`Could not start import: ${error.message}`);
  return data.importRunId as string;
}
