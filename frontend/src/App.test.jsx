import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App auth entry", () => {
  it("renders the login page for an unauthenticated user", async () => {
    window.history.pushState({}, "", "/");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Добро пожаловать" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("90 123-45-67")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Войти" })).toBeInTheDocument();
  });
});
