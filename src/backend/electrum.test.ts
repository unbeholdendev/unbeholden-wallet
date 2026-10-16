import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionError } from "./backend";
import { electrumBackend } from "./electrum";

describe("connecting from an https page", () => {
  afterEach(() => vi.unstubAllGlobals());

  function failure(url: string) {
    vi.stubGlobal("location", { protocol: "https:" });
    let tried = false;
    vi.stubGlobal(
      "WebSocket",
      class {
        constructor() {
          tried = true;
          throw new Error("No network in this test");
        }
      },
    );
    return electrumBackend(url)
      .connect()
      .then(
        () => null,
        (thrown: unknown) => ({
          failure: (thrown as Partial<ConnectionError>).failure,
          tried,
        }),
      );
  }

  it("refuses a plain ws:// server without trying it", async () => {
    expect(await failure("ws://node.example:50003")).toEqual({
      failure: "mixed-content",
      tried: false,
    });
  });

  it("still tries a plain ws:// server on this machine", async () => {
    expect((await failure("ws://127.0.0.1:50003"))?.tried).toBe(true);
  });
});
