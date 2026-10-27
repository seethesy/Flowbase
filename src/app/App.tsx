import { DemoProvider } from "./store";
import { RouterProvider } from "react-router-dom";
import { getRouter } from "./router";
import { AuthGate } from "./auth";
export function App() {
  return (
    <AuthGate>
      <Workspace />
    </AuthGate>
  );
}

function Workspace() {
  return (
    <DemoProvider><RouterProvider router={getRouter()} /></DemoProvider>
  );
}
