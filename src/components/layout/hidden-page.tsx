import { Link } from "react-router-dom";
import { T } from "../../app/copy";
import { EmptyState } from "../shared";

// A page the Admin hid from this role (FLOW-284 req. 5), with a link to the
// role's first visible page. The API still answers by area permissions.
export default function HiddenPage({ first }: { first: string | null }) {
  return (
    <section className="panel hidden-page">
      <EmptyState
        title={<T id="app-shell.hidden-page.title">Not available for your role</T>}
        description={<T id="app-shell.hidden-page.description">Your Admin has hidden this page for your role.</T>}
      />
      {first && (
        <p className="hidden-page-link">
          <Link to={first}>
            <T id="app-shell.hidden-page.go-to-first-page">Go to your first page</T>
          </Link>
        </p>
      )}
    </section>
  );
}
