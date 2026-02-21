import { describe, expect, it, vi } from "vitest";

import { downloadMakerWorldModelFile, resolveMakerWorldModel } from "./index.js";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function htmlResponse(html: string, status = 200) {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

describe("resolveMakerWorldModel", () => {
  it("resolves via design-service happy path and honors URL hash variant selection", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/v1/design-service/design/1400373/instances")) {
        return jsonResponse({
          instances: [
            {
              id: 1452154,
              profileId: 298919107,
              title: "Seed Starter Tray – 9 Cells",
              printerName: "Bambu Lab P2S",
              material: "PLA Basic",
              prediction: "11.1 h",
              weight: 61,
            },
          ],
        });
      }
      if (url.includes("/v1/design-service/design/1400373/model")) {
        return jsonResponse({ downloadUrl: "https://makerworld.cdn/files/seed-starter.3mf" });
      }
      if (url.includes("/v1/design-service/instance/1452154/f3mf")) {
        return jsonResponse({ url: "https://makerworld.cdn/files/seed-starter-selected.3mf" });
      }
      if (url.includes("/v1/design-service/design/1400373")) {
        return jsonResponse({ title: "Self Watering Seed Starter" });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await resolveMakerWorldModel(
        "https://makerworld.com/de/models/1400373-self-watering-seed-starter-with-modular-grow-kit#profileId-1452154",
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.state).toBe("resolved");
      expect(result.data.selectionStrategy).toBe("requested_variant_id");
      expect(result.data.selectedVariantId).toBe(1452154);
      expect(result.data.sourceProfileEstimatedHours).toBe(11.1);
      expect(result.data.sourceProfileEstimatedGrams).toBe(61);
      expect(result.data.profileResolutionMode).toBe("strict");
      expect(result.diagnostics.pipeline).toEqual(["api"]);
      expect(result.data.downloadUrl).toContain("selected.3mf");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("honors explicit variantId override from caller", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/v1/design-service/design/999/instances")) {
        return jsonResponse({
          instances: [
            {
              id: 5001,
              profileId: 6101,
              title: "Variant A",
              printerName: "Bambu Lab P2S",
              material: "PLA Basic",
              prediction: "4.4 h",
              weight: 42,
            },
            {
              id: 5002,
              profileId: 6102,
              title: "Variant B",
              printerName: "Bambu Lab P2S",
              material: "PLA Basic",
              prediction: "3.0 h",
              weight: 39,
            },
          ],
        });
      }
      if (url.includes("/v1/design-service/instance/5002/f3mf")) {
        return jsonResponse({ url: "https://makerworld.cdn/files/variant-b.3mf" });
      }
      if (url.includes("/v1/design-service/design/999/model")) {
        return jsonResponse({});
      }
      if (url.includes("/v1/design-service/design/999")) {
        return jsonResponse({ title: "Model 999" });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await resolveMakerWorldModel("https://makerworld.com/en/models/999-demo", {
        variantId: 5002,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.selectionStrategy).toBe("user_selected_variant");
      expect(result.data.selectedVariantId).toBe(5002);
      expect(result.data.availableVariants).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("forwards request timeout/retry/header options to design-service requests", async () => {
    let instanceCallCount = 0;
    const seenClientHeaders: string[] = [];

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      seenClientHeaders.push(headers.get("x-mw-test-client") ?? "");

      if (url.includes("/v1/design-service/design/1001/instances")) {
        instanceCallCount += 1;
        if (instanceCallCount === 1) {
          throw new Error("temporary network error");
        }
        return jsonResponse({
          instances: [
            {
              id: 5010,
              profileId: 9010,
              title: "Test Variant",
              printerName: "Bambu Lab P2S",
              material: "PLA Basic",
              prediction: "2.2 h",
              weight: 30,
            },
          ],
        });
      }
      if (url.includes("/v1/design-service/design/1001/model")) {
        return jsonResponse({ downloadUrl: "https://makerworld.cdn/files/test.3mf" });
      }
      if (url.includes("/v1/design-service/instance/5010/f3mf")) {
        return jsonResponse({ url: "https://makerworld.cdn/files/test-selected.3mf" });
      }
      if (url.includes("/v1/design-service/design/1001")) {
        return jsonResponse({ title: "Model 1001" });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await resolveMakerWorldModel("https://makerworld.com/en/models/1001-test", {
        request: {
          timeoutMs: 3_000,
          retries: 1,
          headers: {
            "x-mw-test-client": "enabled",
          },
        },
      });

      expect(result.ok).toBe(true);
      expect(instanceCallCount).toBe(2);
      expect(seenClientHeaders.every((value) => value === "enabled")).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("falls back to __NEXT_DATA__ when API path fails", async () => {
    const nextDataPayload = {
      props: {
        pageProps: {
          design: {
            title: "Fallback design",
            instances: [
              {
                id: 1452154,
                profileId: 298919107,
                title: "Fallback Variant",
                printerName: "Bambu Lab P2S",
                material: "PLA Basic",
                prediction: "6.2 h",
                weight: 33,
              },
            ],
          },
        },
      },
    };

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/v1/design-service/design/1400373/instances")) {
        return jsonResponse({ error: "blocked" }, 403);
      }
      if (url.includes("/v1/design-service/design/1400373")) {
        return jsonResponse({ error: "blocked" }, 403);
      }
      if (url.includes("makerworld.com/de/models/1400373")) {
        return htmlResponse(
          `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextDataPayload)}</script></body></html>`,
        );
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await resolveMakerWorldModel("https://makerworld.com/de/models/1400373-fallback");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.diagnostics.pipeline).toEqual(["api", "next_data"]);
      expect(result.data.selectedVariantId).toBe(1452154);
      expect(result.data.importWarnings).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("prefers variant-like arrays over generic page data arrays in __NEXT_DATA__", async () => {
    const nextDataPayload = {
      props: {
        pageProps: {
          data: [
            { title: "Related model 1", image: "/thumb-1.jpg" },
            { title: "Related model 2", image: "/thumb-2.jpg" },
            { title: "Related model 3", image: "/thumb-3.jpg" },
            { title: "Related model 4", image: "/thumb-4.jpg" },
          ],
          design: {
            title: "Cushiony Keyboard Wrist Rest",
            instances: [
              {
                id: 2609620,
                profileId: 2609620,
                title: "0.2mm Balanced",
                printerName: "Bambu Lab P2S",
                material: "PLA Basic",
                prediction: "2.4 h",
                weight: 55,
              },
            ],
          },
        },
      },
    };

    const sourceUrl =
      "https://makerworld.com/de/models/2382903-cushiony-keyboard-wrist-rest?from=recommend#profileId-2609620";

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/v1/design-service/design/2382903/instances")) {
        return jsonResponse({ error: "blocked" }, 403);
      }
      if (url.includes("/v1/design-service/design/2382903")) {
        return jsonResponse({ error: "blocked" }, 403);
      }
      if (url.includes("makerworld.com/de/models/2382903")) {
        return htmlResponse(
          `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextDataPayload)}</script></body></html>`,
        );
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await resolveMakerWorldModel(sourceUrl);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.selectedVariantId).toBe(2609620);
      expect(result.data.selectionStrategy).toBe("requested_variant_id");
      expect(result.diagnostics.pipeline).toEqual(["api", "next_data"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("prefers explicit prediction over generic createTime-like fields for hour extraction", async () => {
    const nextDataPayload = {
      props: {
        pageProps: {
          design: {
            title: "MojoBus Remote Control Version",
            instances: [
              {
                id: 2577822,
                profileId: 601017329,
                title: "0.2mm layer, 2 walls, 15% infill",
                createTime: 396556,
                prediction: "16.7 h",
                weight: 403,
              },
            ],
          },
        },
      },
    };

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/v1/design-service/design/2356539/instances")) {
        return jsonResponse({ error: "blocked" }, 403);
      }
      if (url.includes("/v1/design-service/design/2356539")) {
        return jsonResponse({ error: "blocked" }, 403);
      }
      if (url.includes("makerworld.com/de/models/2356539")) {
        return htmlResponse(
          `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextDataPayload)}</script></body></html>`,
        );
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await resolveMakerWorldModel(
        "https://makerworld.com/de/models/2356539-mojobus-remote-control-version?from=recommend#profileId-2577822",
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.sourceProfileEstimatedHours).toBe(16.7);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("interprets numeric prediction plate values as seconds instead of minutes", async () => {
    const nextDataPayload = {
      props: {
        pageProps: {
          design: {
            title: "MojoBus Remote Control Version",
            instances: [
              {
                id: 2577822,
                profileId: 601017329,
                title: "0.2mm layer, 2 walls, 15% infill",
                extention: {
                  modelInfo: {
                    plates: [
                      { prediction: 6527 },
                      { prediction: 6103 },
                      { prediction: 1474 },
                      { prediction: 12401 },
                      { prediction: 4228 },
                      { prediction: 22366 },
                      { prediction: 7039 },
                    ],
                  },
                },
                prediction: 60138,
                weight: 403,
              },
            ],
          },
        },
      },
    };

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/v1/design-service/design/2356539/instances")) {
        return jsonResponse({ error: "blocked" }, 403);
      }
      if (url.includes("/v1/design-service/design/2356539")) {
        return jsonResponse({ error: "blocked" }, 403);
      }
      if (url.includes("makerworld.com/de/models/2356539")) {
        return htmlResponse(
          `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextDataPayload)}</script></body></html>`,
        );
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await resolveMakerWorldModel(
        "https://makerworld.com/de/models/2356539-mojobus-remote-control-version?from=recommend#profileId-2577822",
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.sourceProfileEstimatedHours).toBeCloseTo(16.705, 3);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps strict resolution mode for explicitly requested variants when printer metadata is unavailable", async () => {
    const nextDataPayload = {
      props: {
        pageProps: {
          design: {
            title: "Unknown printer variant",
            instances: [
              {
                id: 2609620,
                profileId: 612345432,
                title: "Requested variant",
                prediction: "17.5 h",
                weight: 150,
              },
            ],
          },
        },
      },
    };

    const sourceUrl =
      "https://makerworld.com/de/models/2382903-cushiony-keyboard-wrist-rest?from=recommend#profileId-2609620";

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/v1/design-service/design/2382903/instances")) {
        return jsonResponse({ error: "blocked" }, 403);
      }
      if (url.includes("/v1/design-service/design/2382903")) {
        return jsonResponse({ error: "blocked" }, 403);
      }
      if (url.includes("/v1/design-service/profile/612345432")) {
        return jsonResponse({ error: "blocked" }, 403);
      }
      if (url.includes("makerworld.com/de/models/2382903")) {
        return htmlResponse(
          `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextDataPayload)}</script></body></html>`,
        );
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await resolveMakerWorldModel(sourceUrl);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.selectionStrategy).toBe("requested_variant_id");
      expect(result.data.profileResolutionMode).toBe("strict");
      expect(result.data.importWarnings.some((warning) => warning.includes("could not be verified strictly"))).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("extracts printer from compatibility object fields in fallback payloads", async () => {
    const nextDataPayload = {
      props: {
        pageProps: {
          design: {
            title: "Compatibility printer model",
            instances: [
              {
                id: 2577822,
                profileId: 601017329,
                title: "0.2mm layer, 2 walls, 15% infill",
                extention: {
                  modelInfo: {
                    compatibility: {
                      devModelName: "N7",
                      devProductName: "P2S",
                    },
                  },
                },
                prediction: 60138,
                weight: 403,
              },
            ],
          },
        },
      },
    };

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/v1/design-service/design/2356539/instances")) {
        return jsonResponse({ error: "blocked" }, 403);
      }
      if (url.includes("/v1/design-service/design/2356539")) {
        return jsonResponse({ error: "blocked" }, 403);
      }
      if (url.includes("makerworld.com/de/models/2356539")) {
        return htmlResponse(
          `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextDataPayload)}</script></body></html>`,
        );
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await resolveMakerWorldModel(
        "https://makerworld.com/de/models/2356539-mojobus-remote-control-version?from=recommend#profileId-2577822",
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.sourceProfilePrinter).toBe("P2S");
      expect(result.data.profileResolutionMode).toBe("strict");
      expect(result.data.importWarnings.some((warning) => warning.includes("inferred from explicitly selected"))).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns unresolvable when API and fallback are unavailable", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/v1/design-service/design/1400/instances")) {
        return jsonResponse({ error: "blocked" }, 403);
      }
      if (url.includes("/v1/design-service/design/1400")) {
        return jsonResponse({ error: "blocked" }, 403);
      }
      if (url.includes("makerworld.com/en/models/1400")) {
        return htmlResponse("<html><body>No next payload</body></html>");
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await resolveMakerWorldModel("https://makerworld.com/en/models/1400-demo");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.state).toBe("unresolvable");
      expect(result.reasonCode).toBe("malformed_payload");
      expect(result.diagnostics.pipeline).toEqual(["api", "next_data"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns unresolvable when only incomplete profile metrics are present", async () => {
    const nextDataPayload = {
      props: {
        pageProps: {
          design: {
            title: "No metrics",
            instances: [
              {
                id: 7001,
                profileId: 8001,
                title: "Broken Variant",
                printerName: "Bambu Lab P2S",
                material: "PLA Basic",
              },
            ],
          },
        },
      },
    };

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/v1/design-service/profile/8001")) {
        return jsonResponse({ profileId: 8001 }, 200);
      }
      if (url.includes("/v1/design-service/design/777/instances")) {
        return jsonResponse({
          instances: [{ id: 7001, profileId: 8001, title: "Broken Variant", printerName: "Bambu Lab P2S" }],
        });
      }
      if (url.includes("/v1/design-service/design/777/model")) {
        return jsonResponse({});
      }
      if (url.includes("/v1/design-service/design/777")) {
        return jsonResponse({ title: "No metrics" });
      }
      if (url.includes("makerworld.com/en/models/777")) {
        return htmlResponse(
          `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextDataPayload)}</script></body></html>`,
        );
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await resolveMakerWorldModel("https://makerworld.com/en/models/777-no-metrics");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.state).toBe("unresolvable");
      expect(result.reasonCode).toBe("missing_profile_metrics");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("never throws on malformed upstream payloads", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/v1/design-service/design/888/instances")) {
        return new Response("{not-json", { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/v1/design-service/design/888")) {
        return new Response("{not-json", { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("makerworld.com/en/models/888")) {
        return htmlResponse("<html><body><script id='__NEXT_DATA__'>not-json</script></body></html>");
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(resolveMakerWorldModel("https://makerworld.com/en/models/888-malformed")).resolves.toMatchObject({
        ok: false,
        state: "unresolvable",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("never throws on empty payloads", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/v1/design-service/design/889/instances")) {
        return new Response("", { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/v1/design-service/design/889")) {
        return new Response("", { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("makerworld.com/en/models/889")) {
        return htmlResponse("<html><body><script id='__NEXT_DATA__'>not-json</script></body></html>");
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(resolveMakerWorldModel("https://makerworld.com/en/models/889-empty")).resolves.toMatchObject({
        ok: false,
        state: "unresolvable",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("never throws on timeout or 404 upstream responses", async () => {
    const abortError = Object.assign(new Error("aborted"), { name: "AbortError" });
    const timeoutFetchMock = vi.fn<typeof fetch>(async () => {
      throw abortError;
    });

    vi.stubGlobal("fetch", timeoutFetchMock);
    try {
      await expect(resolveMakerWorldModel("https://makerworld.com/en/models/890-timeout")).resolves.toMatchObject({
        ok: false,
        state: "unresolvable",
        reasonCode: "timeout",
      });
    } finally {
      vi.unstubAllGlobals();
    }

    const notFoundFetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/v1/design-service/design/891/instances")) {
        return jsonResponse({ error: "not found" }, 404);
      }
      if (url.includes("/v1/design-service/design/891")) {
        return jsonResponse({ error: "not found" }, 404);
      }
      if (url.includes("makerworld.com/en/models/891")) {
        return htmlResponse("<html><body>missing</body></html>", 404);
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    vi.stubGlobal("fetch", notFoundFetchMock);
    try {
      await expect(resolveMakerWorldModel("https://makerworld.com/en/models/891-not-found")).resolves.toMatchObject({
        ok: false,
        state: "unresolvable",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("downloadMakerWorldModelFile", () => {
  it("returns downloaded outcome for supported 3mf payload", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(Buffer.from("PK\x03\x04"), {
        status: 200,
        headers: {
          "content-type": "model/3mf",
          "content-disposition": 'attachment; filename="part.3mf"',
        },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await downloadMakerWorldModelFile("https://makerworld.com/files/part");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.state).toBe("downloaded");
      expect(result.extension).toBe("3mf");
      expect(result.filename).toBe("part.3mf");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns unavailable outcome for HTTP failures", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("not found", { status: 404 }));

    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await downloadMakerWorldModelFile("https://makerworld.com/files/missing");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.state).toBe("unavailable");
      expect(result.reasonCode).toBe("not_found");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns unavailable outcome for unsupported file types", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(Buffer.from("plain-text"), {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await downloadMakerWorldModelFile("https://makerworld.com/files/raw");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.state).toBe("unavailable");
      expect(result.reasonCode).toBe("unsupported_model_format");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("applies custom download headers and maxBytes overrides", async () => {
    let observedHeader = "";
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      observedHeader = new Headers(init?.headers).get("x-mw-download-test") ?? "";
      return new Response(Buffer.from("1234"), {
        status: 200,
        headers: { "content-type": "model/3mf" },
      });
    });

    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await downloadMakerWorldModelFile("https://makerworld.com/files/custom", {
        maxBytes: 8,
        timeoutMs: 5_000,
        headers: { "x-mw-download-test": "ok" },
      });
      expect(observedHeader).toBe("ok");
      expect(result.ok).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
