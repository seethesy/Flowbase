import { RouterProvider } from "react-router-dom";
import { DemoProvider } from "./store";
import { router } from "./router";
export function App() {
  return (
    <DemoProvider>
      <RouterProvider router={router} />
    </DemoProvider>
  );
}
