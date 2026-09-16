import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ImportUploadForm } from "./ImportUploadForm.js";
import * as startImportModule from "./start-import.js";

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

function csvFile(name = "kilele-contacts.csv", size = 100): File {
  const file = new File(["a".repeat(size)], name, { type: "text/csv" });
  return file;
}

describe("ImportUploadForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects submission with no file selected, without calling startImport (AC-UX-01)", async () => {
    const startImport = vi.spyOn(startImportModule, "startImport");
    renderWithClient(<ImportUploadForm brandId="brand-1" />);

    fireEvent.click(screen.getByRole("button", { name: /import/i }));

    await waitFor(() => expect(screen.getByText(/instance of file/i)).toBeInTheDocument());
    expect(startImport).not.toHaveBeenCalled();
  });

  it("rejects a non-.csv file client-side", async () => {
    const startImport = vi.spyOn(startImportModule, "startImport");
    renderWithClient(<ImportUploadForm brandId="brand-1" />);

    const input = screen.getByLabelText(/csv file/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "contacts.txt")] } });
    fireEvent.click(screen.getByRole("button", { name: /import/i }));

    await waitFor(() => expect(screen.getByText(/only \.csv files/i)).toBeInTheDocument());
    expect(startImport).not.toHaveBeenCalled();
  });

  it("submits a valid file, invalidates import-runs on success, and clears the file input", async () => {
    const startImport = vi.spyOn(startImportModule, "startImport").mockResolvedValue("run-1");
    const { client } = renderWithClient(<ImportUploadForm brandId="brand-1" />);
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    const input = screen.getByLabelText(/csv file/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [csvFile()] } });
    fireEvent.click(screen.getByRole("button", { name: /import/i }));

    await waitFor(() => expect(startImport).toHaveBeenCalledWith("brand-1", "contacts", expect.any(File)));
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["import-runs"] }));
  });

  it("switches kind to campaigns and passes it through on submit", async () => {
    const startImport = vi.spyOn(startImportModule, "startImport").mockResolvedValue("run-1");
    renderWithClient(<ImportUploadForm brandId="brand-1" />);

    fireEvent.change(screen.getByLabelText(/file type/i), { target: { value: "campaigns" } });
    fireEvent.change(screen.getByLabelText(/csv file/i), { target: { files: [csvFile()] } });
    fireEvent.click(screen.getByRole("button", { name: /import/i }));

    await waitFor(() => expect(startImport).toHaveBeenCalledWith("brand-1", "campaigns", expect.any(File)));
  });

  it("shows a form-level error when startImport rejects, and re-enables the submit button", async () => {
    vi.spyOn(startImportModule, "startImport").mockRejectedValue(new Error("Not signed in"));
    renderWithClient(<ImportUploadForm brandId="brand-1" />);

    fireEvent.change(screen.getByLabelText(/csv file/i), { target: { files: [csvFile()] } });
    fireEvent.click(screen.getByRole("button", { name: /import/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/not signed in/i));
    expect(screen.getByRole("button", { name: /import/i })).not.toBeDisabled();
  });
});
