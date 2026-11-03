import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CreateJobForm } from "@/components/create-job-form";

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CreateJobForm />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CreateJobForm", () => {
  it("blocks an invalid URL on the client without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderForm();

    await userEvent.type(screen.getByLabelText(/source url/i), "https://cdn.example.com");
    await userEvent.click(screen.getByRole("button", { name: /create job/i }));

    expect(await screen.findByText(/full http\(s\) link/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a server field error back onto the Source URL input", async () => {
    // The client accepts this URL, but the server rejects it: the form must show the server's message on the field.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ detail: "Invalid input", fieldErrors: { sourceUrl: "Server says no" } }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    renderForm();

    await userEvent.type(screen.getByLabelText(/source url/i), "https://cdn.example.com/videos/clip.mp4");
    await userEvent.click(screen.getByRole("button", { name: /create job/i }));

    expect(await screen.findByText("Server says no")).toBeInTheDocument();
  });

  it("clears the form after a successful create", async () => {
    const job = { id: "j_1", title: "clip.mp4", sourceUrl: "x", status: "NEW", createdAt: "" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(job), { status: 201, headers: { "content-type": "application/json" } })),
    );
    renderForm();

    const input = screen.getByLabelText(/source url/i) as HTMLInputElement;
    await userEvent.type(input, "https://cdn.example.com/videos/clip.mp4");
    await userEvent.click(screen.getByRole("button", { name: /create job/i }));

    await waitFor(() => expect(input.value).toBe(""));
  });
});
