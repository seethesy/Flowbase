import { RouterProvider } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./queryClient";
import { DemoProvider } from "./store";
import { getRouter } from "./router";
import { AuthGate } from "./auth";
import { CopyProvider } from "./copy";
import { usePermissions } from "./permissions";
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
  // Admin live text editing (FLOW-240): saved wording for every screen.
  const permissions = usePermissions();
  return (
    <CopyProvider canEdit={permissions.can("copy.edit")} canEditLayout={permissions.can("layout.edit")}>
      <DemoProvider><RouterProvider router={getRouter()} /></DemoProvider>
    </CopyProvider>
  );
}
