import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  manifestVersion: 2,
  manifest: {
    name: "Undoom",
    description: "Short sessions on the sites you doomscroll, with a rest between them.",
    permissions: [
      "storage",
      "idle",
      "identity",
      "webRequest",
      "webRequestBlocking",
      // Blocked sites can be any custom domain, and the API host is covered by it too.
      "<all_urls>",
    ],
    // Firefox only lets webRequest redirect to extension pages that are web accessible.
    web_accessible_resources: ["blocked.html"],
    browser_specific_settings: {
      gecko: {
        id: "undoom@seria.moe",
        strict_min_version: "140.0",
        // Time spent on the user's limited sites is synced to the Undoom server.
        data_collection_permissions: { required: ["browsingActivity"] },
      },
    },
  },
});
