import { defineConfig } from "orval";

export default defineConfig({
  apiZod: {
    input: "openapi.yaml",
    output: {
      mode: "single",
      target: "../api-zod/src/generated/api.ts",
      client: "zod",
      fileExtension: ".ts",
    },
  },
  apiClientReact: {
    input: "openapi.yaml",
    output: {
      mode: "single",
      target: "../api-client-react/src/generated/api.ts",
      schemas: "../api-client-react/src/generated/types",
      client: "react-query",
      httpClient: "fetch",
      baseUrl: "/api",
      override: {
        mutator: {
          path: "../api-client-react/src/custom-fetch.ts",
          name: "customFetch",
        },
      },
    },
  },
});
