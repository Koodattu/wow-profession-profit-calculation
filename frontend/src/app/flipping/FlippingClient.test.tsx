import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import FlippingClient from "./FlippingClient";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test("a failed comparison is not reported as no opportunities and retry preserves filters", async () => {
  let offline = true;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("opportunities") && offline) throw new Error("offline");
    return Response.json([]);
  }));
  render(<FlippingClient />);
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t load realm comparisons"));
  expect(screen.queryByText("No flipping opportunities found")).toBeNull();
  fireEvent.change(screen.getByRole("spinbutton", { name: "Min spread" }), { target: { value: "50" } });
  await screen.findByRole("button", { name: "Retry comparison" });
  offline = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry comparison" }));
  await screen.findByText("No items match these comparison filters.");
  expect(screen.getByRole("spinbutton", { name: "Min spread" })).toHaveValue(50);
});
