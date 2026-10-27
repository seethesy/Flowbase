import { RouterProvider } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./queryClient";
import { DemoProvider } from "./store";
import { getRouter } from "./router";
import { AuthGate } from "./auth";
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
    <DemoProvider><RouterProvider router={getRouter()} /></DemoProvider>
  );
}
