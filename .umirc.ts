import { defineConfig } from "umi";

export default defineConfig({
  routes: [
    { path: "/mapbox", component: "mapbox/mapbox" },
  ],
  npmClient: 'pnpm',
});
