import { createHashRouter, Link } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { Dashboard } from "../features/dashboard";
import { CustomerList, CustomerDetail } from "../features/crm";
import { Contracts } from "../features/contracts";
import { InventoryList, InventoryDetail } from "../features/inventory";
import { Button, PageHeader, Section } from "../components/shared";
import { Leaf } from "lucide-react";
function Placeholder() {
  return (
    <>
      <PageHeader
        title="Room to grow"
        subtitle="A peek at what comes next for your workspace."
      />
      <Section title="Not included in demo">
        <div className="placeholder-content">
          <Leaf size={40} />
          <h2>One step at a time.</h2>
          <p>
            This module is a placeholder in Flowbase v0.1. Explore CRM,
            contracts, and inventory to see the interactive prototype.
          </p>
          <Button asChild>
            <Link to="/">Back to overview</Link>
          </Button>
        </div>
      </Section>
    </>
  );
}
function Profile() {
  return (
    <>
      <PageHeader
        title="Alex Chen"
        subtitle="Operations manager · CoreOps catering workspace"
      />
      <Section title="Employee profile">
        <p>Fictional employee · Demo session</p>
        <p>
          Alex coordinates customer relationships, event contracts, and
          inventory for the team.
        </p>
        <p className="demo-callout">
          No authentication or account changes are included in this prototype.
        </p>
      </Section>
    </>
  );
}
export const router = createHashRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <Dashboard /> },
      { path: "/crm", element: <CustomerList /> },
      { path: "/crm/:id", element: <CustomerDetail /> },
      { path: "/contracts", element: <Contracts /> },
      { path: "/inventory", element: <InventoryList /> },
      { path: "/inventory/:id", element: <InventoryDetail /> },
      { path: "/profile", element: <Profile /> },
      ...["purchasing", "events", "reports", "settings", "help", "*"].map(
        (path) => ({ path, element: <Placeholder /> }),
      ),
    ],
  },
]);
