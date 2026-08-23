import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithI18n as render } from "../test-utils";
import type { CardId } from "../settings";
import { DisplaySettings } from "./DisplaySettings";

const available: CardId[] = ["cpu", "memory", "disk", "pressure"];

const open = async () => {
  const user = userEvent.setup();
  render(<DisplaySettings available={available} />);
  await user.click(screen.getByRole("button", { name: "Display" }));
  return user;
};

describe("DisplaySettings", () => {
  it("stays out of the way until it is asked for", () => {
    render(<DisplaySettings available={available} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Display" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("lists the cards this machine can fill, and nothing else", async () => {
    await open();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "CPU" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Pressure" })).toBeChecked();
    // this machine has no fan tachometer: hiding one would mean nothing
    expect(screen.queryByRole("checkbox", { name: "Fan" })).toBeNull();
  });

  it("hides a card, counts it on the button and brings it back", async () => {
    const user = await open();

    await user.click(screen.getByRole("checkbox", { name: "Memory" }));
    expect(screen.getByRole("checkbox", { name: "Memory" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Display" })).toHaveTextContent("1");

    await user.click(screen.getByRole("button", { name: "Show every card" }));
    expect(screen.getByRole("checkbox", { name: "Memory" })).toBeChecked();
    expect(screen.queryByRole("button", { name: "Show every card" })).toBeNull();
  });

  it("turns the detailed rows on and off", async () => {
    const user = await open();
    const toggle = screen.getByRole("checkbox", { name: /Detailed rows/ });
    expect(toggle).not.toBeChecked();

    await user.click(toggle);
    expect(screen.getByRole("checkbox", { name: /Detailed rows/ })).toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: /Detailed rows/ }));
    expect(screen.getByRole("checkbox", { name: /Detailed rows/ })).not.toBeChecked();
  });

  it("closes on Escape, on a click outside, but not on one inside", async () => {
    const user = await open();

    await user.click(screen.getByRole("checkbox", { name: "CPU" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Display" }));
    await user.keyboard("x");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes when the button is pressed again", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Display" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
