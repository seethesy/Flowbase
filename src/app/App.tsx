import { RouterProvider } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./queryClient";
import { DemoProvider } from "./store";
import { getRouter } from "./router";
import { AuthGate } from "./auth";
import { CopyProvider } from "./live-copy";
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthGate>
        <Workspace />
      </AuthGate>
    </QueryClientProvider>
  );
}

function Workspace() {
  return (
    // The admin's wording for every screen (FLOW-240), once signed in.
    <CopyProvider>
      <DemoProvider><RouterProvider router={getRouter()} /></DemoProvider>
    </CopyProvider>
  );
}
