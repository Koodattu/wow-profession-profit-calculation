import { fireEvent, screen, within } from "@testing-library/react";

export function chooseRealm(name: string) {
  fireEvent.click(screen.getByRole("button", { name: /^Connected realm:/ }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Choose your realm" })).getByRole("button", { name }));
}
