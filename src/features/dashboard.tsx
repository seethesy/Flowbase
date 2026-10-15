import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Users,
  FileText,
  CheckCheck,
  Package,
  Plus,
  ArrowUpRight,
  ArrowRight,
  CalendarDays,
  Clock,
  Leaf,
  Check,
  MessageSquare,
  Truck,
  UserPlus,
  Send,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { useDemo } from "../app/store";
import { activities, events, stages } from "../data/mock/fixtures";
import { money, stockStatus, date } from "../services/records";
import {
  PageHeader,
  Button,
  KpiCard,
  Section,
  StatusBadge,
} from "../components/shared";
import { RecordForm } from "./forms";
import { ContractDrawer } from "./contracts";
export function ActivityFeed() {
  const icons = [Check, MessageSquare, Truck, UserPlus, Send];
  return (
    <div className="activity-feed">
      {activities.map((a, i) => {
        const Icon = icons[i];
        return (
          <Link to={a.path} key={a.text} className="activity-row">
            <span className={`activity-icon activity-${i}`}>
              <Icon size={16} />
            </span>
            <div>
              <strong>{a.text}</strong>
              <p>{a.detail}</p>
              <small>{a.time}</small>
            </div>
            <ArrowUpRight size={15} className="activity-arrow" />
          </Link>
        );
      })}
    </div>
  );
}
export function Dashboard() {
  const store = useDemo();
  const navigate = useNavigate();
  const [range, setRange] = useState("This month");
  const [create, setCreate] = useState(false);
  const [contract, setContract] = useState<string | null>(null);
  const all = store.contracts.list();
  const ranged =
    range === "This week"
      ? all.filter((_, i) => i % 3 === 0)
      : range === "Last month"
        ? all.filter((_, i) => i % 2 === 0)
        : all;
  const active = store.customers.list().filter((c) => c.status === "Active");
  const open = ranged.filter((c) => !["Signed", "Lost"].includes(c.stage));
  const signed = ranged.filter((c) => c.stage === "Signed");
  const alerts = store.inventory
    .list()
    .filter((i) => stockStatus(i) !== "In Stock");
  const chart = stages.map((name) => ({
    name,
    value: ranged.filter((c) => c.stage === name).length,
  }));
  const colors = ["#B6C4BA", "#89A9C6", "#D7AC65", "#327459", "#CBA5A1"];
  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Business at a glance. A little clarity for your busy day."
        eyebrow="THURSDAY, OCTOBER 15, 2026"
      >
        <label className="range-select">
          <CalendarDays size={15} />
          <select
            aria-label="Dashboard date range"
            value={range}
            onChange={(e) => setRange(e.target.value)}
          >
            {["This month", "This week", "Last month"].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <Button onClick={() => setCreate(true)}>
          <Plus size={16} />
          New Contract
        </Button>
      </PageHeader>
      <div className="welcome-strip">
        <div className="welcome-icon">
          <Leaf size={22} />
        </div>
        <div>
          <strong>A good day to keep things flowing.</strong>
          <p>
            You have {open.length} open contracts and {alerts.length} inventory
            items that need a little attention.
          </p>
        </div>
        <span className="live-pill">
          <span />
          Demo workspace
        </span>
      </div>
      <div className="kpi-grid">
        <KpiCard
          label="Active Customers"
          value={active.length}
          icon={<Users size={19} />}
          comparison="Customer relationships"
          onClick={() => navigate("/crm?status=Active")}
        />
        <KpiCard
          label="Open Contracts"
          value={open.length}
          icon={<FileText size={19} />}
          comparison={`${money(open.reduce((a, c) => a + c.value, 0))} in pipeline`}
          onClick={() => navigate("/contracts?open=1")}
        />
        <KpiCard
          label="Contracts Won This Month"
          value={signed.length}
          icon={<CheckCheck size={19} />}
          comparison={`${money(signed.reduce((a, c) => a + c.value, 0))} in signed value`}
          onClick={() => navigate("/contracts?stage=Signed")}
        />
        <KpiCard
          label="Inventory Alerts"
          value={alerts.length}
          icon={<Package size={19} />}
          comparison={`${alerts.filter((i) => stockStatus(i) === "Out of Stock").length} out of stock · needs review`}
          onClick={() => navigate("/inventory?status=Alerts")}
        />
      </div>
      <div className="dashboard-grid">
        <div className="dashboard-main">
          <Section
            title="Recent activity"
            action={
              <span className="subtle-tag">
                <Clock size={12} /> Today
              </span>
            }
          >
            <ActivityFeed />
          </Section>
          <Section
            title="Recent contracts"
            action={
              <Link className="text-link" to="/contracts?view=table">
                View all <ArrowUpRight size={14} />
              </Link>
            }
          >
            <div className="table-scroll">
              <table className="compact-table">
                <thead>
                  <tr>
                    <th>Contract / Customer</th>
                    <th>Value</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {ranged.slice(0, 5).map((c) => (
                    <tr key={c.id}>
                      <td>
                        <button
                          className="table-link contract-name"
                          onClick={() => setContract(c.id)}
                        >
                          {c.name}
                          <small>
                            {store.customers.get(c.customerId)?.name}
                          </small>
                        </button>
                      </td>
                      <td>{money(c.value)}</td>
                      <td>
                        <StatusBadge status={c.stage} />
                      </td>
                      <td>
                        <button
                          aria-label={`Open ${c.id}`}
                          onClick={() => setContract(c.id)}
                        >
                          <ArrowUpRight size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          <div className="workspace-note">
            <span className="brand-mark small-mark">f</span>
            <span>Less admin. More room for what matters.</span>
            <span>Flowbase v0.1</span>
          </div>
        </div>
        <div className="dashboard-aside">
          <Section
            title="Contracts by status"
            action={
              <Link to="/contracts" aria-label="View contract pipeline">
                <ArrowUpRight size={17} />
              </Link>
            }
          >
            <div className="chart-layout">
              <div className="donut">
                <ResponsiveContainer width="100%" height={174}>
                  <PieChart>
                    <Pie
                      data={chart}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={55}
                      outerRadius={73}
                      paddingAngle={4}
                      stroke="none"
                    >
                      {chart.map((c, i) => (
                        <Cell key={c.name} fill={colors[i]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="donut-label">
                  <strong>{ranged.length}</strong>
                  <small>contracts</small>
                </div>
              </div>
              <div className="chart-legend">
                {chart.map((c, i) => (
                  <button
                    key={c.name}
                    onClick={() => navigate(`/contracts?stage=${c.name}`)}
                  >
                    <span style={{ background: colors[i] }} />
                    <span>{c.name}</span>
                    <b>{c.value}</b>
                  </button>
                ))}
              </div>
            </div>
            <p className="chart-caption">
              {range} · {money(ranged.reduce((a, c) => a + c.value, 0))} total
              value
            </p>
          </Section>
          <Section
            title="Stock needs attention"
            action={<span className="alert-count">{alerts.length}</span>}
          >
            <div className="low-stock-list">
              {alerts.slice(0, 3).map((i) => (
                <Link to={`/inventory/${i.id}`} key={i.id}>
                  <span className="stock-item-icon">
                    <Package size={17} />
                  </span>
                  <div>
                    <strong>{i.name}</strong>
                    <small>
                      {i.onHand - i.reserved} {i.unit} available · reorder at{" "}
                      {i.reorder} {i.unit}
                    </small>
                  </div>
                  <StatusBadge status={stockStatus(i)} />
                </Link>
              ))}
            </div>
            <Link className="panel-bottom-link" to="/inventory?status=Alerts">
              Review inventory <ArrowRight size={14} />
            </Link>
          </Section>
          <Section
            title="Coming up"
            action={
              <Link to="/events" aria-label="View events">
                <ArrowUpRight size={17} />
              </Link>
            }
          >
            {events.slice(0, 2).map((e) => (
              <Link
                className="event-row"
                key={e.id}
                to={`/crm/${e.customerId}`}
              >
                <div className="event-date">
                  <b>{e.date.slice(-2)}</b>
                  <span>OCT</span>
                </div>
                <div>
                  <strong>{e.name}</strong>
                  <small>
                    {date(e.date)} · {e.guests} guests
                  </small>
                </div>
              </Link>
            ))}
          </Section>
        </div>
      </div>
      {create && (
        <RecordForm kind="contract" onClose={() => setCreate(false)} />
      )}{" "}
      {contract && (
        <ContractDrawer id={contract} onClose={() => setContract(null)} />
      )}
    </>
  );
}
