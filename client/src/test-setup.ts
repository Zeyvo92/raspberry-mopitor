import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  // the language picker persists a choice — don't leak it into the next test
  localStorage.clear();
});
