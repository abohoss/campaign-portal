import { describe, expect, it, vi, beforeEach } from "vitest";
import { startImport } from "./start-import.js";
import { supabase } from "@/lib/supabase.js";

function file(name = "kilele-contacts.csv"): File {
  return new File(["external_id,email\nCT-1,a@vg-eval.test\n"], name, { type: "text/csv" });
}

describe("startImport", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when there is no session, without touching Storage", async () => {
    vi.spyOn(supabase.auth, "getSession").mockResolvedValue({ data: { session: null }, error: null } as never);
    const upload = vi.fn();
    vi.spyOn(supabase.storage, "from").mockReturnValue({ upload } as never);

    await expect(startImport("brand-1", "contacts", file())).rejects.toThrow("Not signed in");
    expect(upload).not.toHaveBeenCalled();
  });

  it("uploads to Storage, then invokes import-start, returning the new run id", async () => {
    vi.spyOn(supabase.auth, "getSession").mockResolvedValue({
      data: { session: { user: { id: "u1" } } },
      error: null,
    } as never);
    const upload = vi.fn().mockResolvedValue({ data: { path: "brand-1/x.csv" }, error: null });
    vi.spyOn(supabase.storage, "from").mockReturnValue({ upload } as never);
    const invoke = vi.fn().mockResolvedValue({ data: { importRunId: "run-42" }, error: null });
    vi.spyOn(supabase, "functions", "get").mockReturnValue({ invoke } as never);

    const runId = await startImport("brand-1", "contacts", file());
    expect(runId).toBe("run-42");
    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(/^brand-1\/\d+-kilele-contacts\.csv$/),
      expect.any(File),
      { contentType: "text/csv" },
    );
    expect(invoke).toHaveBeenCalledWith(
      "import-start",
      expect.objectContaining({ body: expect.objectContaining({ brandId: "brand-1", kind: "contacts" }) }),
    );
  });

  it("throws a descriptive error when the Storage upload fails", async () => {
    vi.spyOn(supabase.auth, "getSession").mockResolvedValue({
      data: { session: { user: { id: "u1" } } },
      error: null,
    } as never);
    vi.spyOn(supabase.storage, "from").mockReturnValue({
      upload: vi.fn().mockResolvedValue({ data: null, error: { message: "quota exceeded" } }),
    } as never);

    await expect(startImport("brand-1", "contacts", file())).rejects.toThrow(/quota exceeded/);
  });

  it("throws a descriptive error when import-start rejects", async () => {
    vi.spyOn(supabase.auth, "getSession").mockResolvedValue({
      data: { session: { user: { id: "u1" } } },
      error: null,
    } as never);
    vi.spyOn(supabase.storage, "from").mockReturnValue({
      upload: vi.fn().mockResolvedValue({ data: { path: "x" }, error: null }),
    } as never);
    vi.spyOn(supabase, "functions", "get").mockReturnValue({
      invoke: vi.fn().mockResolvedValue({ data: null, error: { message: "not an owner" } }),
    } as never);

    await expect(startImport("brand-1", "contacts", file())).rejects.toThrow(/not an owner/);
  });
});
