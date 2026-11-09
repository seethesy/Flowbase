import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { FlowEvent } from "../../shared/core-records";
import {
  dollarsToCents,
  formatCents,
  paymentMethodLabels,
  paymentMethods,
  scheduleKindLabels,
  scheduleKinds,
  type EventPayments,
  type PaymentInput,
  type PaymentMethod,
  type PaymentSuggestion,
  type ScheduleKind,
} from "../../shared/payments";
import { useResource } from "../app/useResource";
import {
  Button,
  DetailDrawer,
  FormField,
  LoadingSkeleton,
  Section,
} from "../components/shared";
import { LoadError } from "../components/record-display";
import { paymentsApi } from "../services/payments";
import { date } from "./event-format";
import "./event-payments.css";

// The event's payment schedule and payment log (FLOW-131), with the overdue flag
// (FLOW-132). Amounts are integer cents everywhere; the forms take dollars.
// The server answers 403 for anyone who may not see the event's financials, so the
// section shows an error rather than an amount.

type ItemForm = {
  id?: string;
  kind: ScheduleKind;
  label: string;
  amount: string;
  dueDate: string;
  source: PaymentSuggestion | null;
};

const centsToDollars = (cents: number) => (cents / 100).toFixed(2);

export function EventPaymentsSection({ event }: { event: FlowEvent }) {
  const payments = useResource(["event-payments", event.id], () =>
    paymentsApi.get(event.id),
  );
  const [error, setError] = useState("");
  const [itemForm, setItemForm] = useState<ItemForm | null>(null);
  const [payForm, setPayForm] = useState(false);
  if (payments.error)
    return (
      <Section title="Payments">
        <LoadError message={payments.error} />
      </Section>
    );
  if (!payments.data) return <LoadingSkeleton />;
  const data = payments.data;
  const change = async (run: () => Promise<EventPayments>) => {
    setError("");
    try {
      payments.replace(await run());
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Section
      title="Payments"
      action={
        data.canEdit && (
          <Button onClick={() => setPayForm(true)}>
            <Plus size={14} />
            Record payment
          </Button>
        )
      }
    >
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <dl className="payments-summary">
        <div>
          <dt>Total</dt>
          <dd>{formatCents(data.totalCents)}</dd>
        </div>
        <div>
          <dt>Paid</dt>
          <dd>{formatCents(data.paidCents)}</dd>
        </div>
        <div>
          <dt>Balance</dt>
          <dd data-testid="payments-balance">{formatCents(data.balanceCents)}</dd>
        </div>
      </dl>
      {data.overdueCount > 0 && (
        <p role="status" className="payments-overdue">
          Overdue: {formatCents(data.overdueCents)} across {data.overdueCount}{" "}
          {data.overdueCount === 1 ? "payment" : "payments"}.
        </p>
      )}
      {data.suggestions.length > 0 && data.canEdit && (
        <div className="payments-suggestions">
          <strong>From the proposal</strong>
          <ul>
            {data.suggestions.map((s) => (
              <li key={`${s.proposalId}:${s.sourceKey}`}>
                <span>
                  {s.text} <small>({s.proposalTitle})</small>
                </span>
                <Button
                  variant="outline"
                  onClick={() =>
                    setItemForm({
                      kind: s.kind,
                      label: s.label,
                      amount: s.amountCents === null ? "" : centsToDollars(s.amountCents),
                      dueDate: s.dueDate ?? "",
                      source: s,
                    })
                  }
                >
                  Add
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="payments-subhead">
        <h3>Schedule</h3>
        {data.canEdit && (
          <Button
            variant="outline"
            onClick={() =>
              setItemForm({
                kind: "deposit",
                label: "",
                amount: "",
                dueDate: "",
                source: null,
              })
            }
          >
            <Plus size={14} />
            Add scheduled payment
          </Button>
        )}
      </div>
      {data.schedule.length === 0 ? (
        <p className="muted">No scheduled payments.</p>
      ) : (
        <div className="table-scroll">
        <table className="payments-table">
          <thead>
            <tr>
              <th>Due</th>
              <th>Item</th>
              <th>Amount</th>
              <th>Paid</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.schedule.map((item) => (
              <tr key={item.id} className={item.overdue ? "overdue" : undefined}>
                <td>{date(item.dueDate)}</td>
                <td>
                  {scheduleKindLabels[item.kind]}
                  {item.label && ` — ${item.label}`}
                </td>
                <td>{formatCents(item.amountCents)}</td>
                <td>{formatCents(item.paidCents)}</td>
                <td>
                  {item.overdue
                    ? "Overdue"
                    : item.remainingCents === 0
                      ? "Paid"
                      : "Due"}
                </td>
                <td>
                  {data.canEdit && (
                    <>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          setItemForm({
                            id: item.id,
                            kind: item.kind,
                            label: item.label,
                            amount: centsToDollars(item.amountCents),
                            dueDate: item.dueDate,
                            source: null,
                          })
                        }
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        aria-label={`Remove ${scheduleKindLabels[item.kind]}`}
                        onClick={() =>
                          change(() => paymentsApi.archiveItem(event.id, item.id))
                        }
                      >
                        <Trash2 size={14} />
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      <h3>Payments received</h3>
      {data.payments.length === 0 ? (
        <p className="muted">No payments recorded.</p>
      ) : (
        <div className="table-scroll">
        <table className="payments-table">
          <thead>
            <tr>
              <th>Received</th>
              <th>Method</th>
              <th>Amount</th>
              <th>Reference</th>
              <th>Recorded by</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.payments.map((p) => (
              <tr key={p.id}>
                <td>{date(p.receivedOn)}</td>
                <td>{paymentMethodLabels[p.method]}</td>
                <td>{formatCents(p.amountCents)}</td>
                <td>{p.reference || "—"}</td>
                <td>{p.recordedBy?.name ?? "—"}</td>
                <td>
                  {data.canEdit && (
                    <Button
                      variant="ghost"
                      aria-label={`Remove payment of ${formatCents(p.amountCents)}`}
                      onClick={() =>
                        change(() => paymentsApi.archivePayment(event.id, p.id))
                      }
                    >
                      <Trash2 size={14} />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      {itemForm && (
        <ScheduleItemDrawer
          form={itemForm}
          onClose={() => setItemForm(null)}
          onSave={async (next) => {
            const input = {
              kind: next.kind,
              label: next.label,
              amountCents: next.cents,
              dueDate: next.dueDate,
              source: itemForm.source
                ? {
                    proposalId: itemForm.source.proposalId,
                    sourceKey: itemForm.source.sourceKey,
                  }
                : null,
            };
            payments.replace(
              itemForm.id
                ? await paymentsApi.updateItem(event.id, itemForm.id, input)
                : await paymentsApi.addItem(event.id, input),
            );
            setItemForm(null);
          }}
        />
      )}
      {payForm && (
        <PaymentDrawer
          today={data.today}
          onClose={() => setPayForm(false)}
          onSave={async (input) => {
            payments.replace(await paymentsApi.record(event.id, input));
            setPayForm(false);
          }}
        />
      )}
    </Section>
  );
}

function ScheduleItemDrawer({
  form,
  onClose,
  onSave,
}: {
  form: ItemForm;
  onClose: () => void;
  onSave: (value: {
    kind: ScheduleKind;
    label: string;
    cents: number;
    dueDate: string;
  }) => Promise<void>;
}) {
  const [draft, setDraft] = useState(form);
  const [error, setError] = useState("");
  const set = <K extends keyof ItemForm>(key: K, value: ItemForm[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  return (
    <DetailDrawer
      open
      onClose={onClose}
      title={form.id ? "Edit scheduled payment" : "Add scheduled payment"}
    >
      <form
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const cents = dollarsToCents(draft.amount);
          if (cents === null || cents <= 0)
            return setError("Enter an amount greater than $0.");
          if (!draft.dueDate) return setError("Enter a due date.");
          try {
            setError("");
            await onSave({
              kind: draft.kind,
              label: draft.label.trim(),
              cents,
              dueDate: draft.dueDate,
            });
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <div className="form-grid">
          <FormField label="Type">
            <select
              value={draft.kind}
              onChange={(e) => set("kind", e.target.value as ScheduleKind)}
            >
              {scheduleKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {scheduleKindLabels[kind]}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Amount ($)">
            <input
              inputMode="decimal"
              value={draft.amount}
              onChange={(e) => set("amount", e.target.value)}
            />
          </FormField>
          <FormField label="Due date">
            <input
              type="date"
              value={draft.dueDate}
              onChange={(e) => set("dueDate", e.target.value)}
            />
          </FormField>
          <FormField label="Label">
            <input
              value={draft.label}
              maxLength={100}
              onChange={(e) => set("label", e.target.value)}
            />
          </FormField>
        </div>
        <div className="form-actions">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Save</Button>
        </div>
      </form>
    </DetailDrawer>
  );
}

function PaymentDrawer({
  today,
  onClose,
  onSave,
}: {
  today: string;
  onClose: () => void;
  onSave: (input: PaymentInput) => Promise<void>;
}) {
  const [method, setMethod] = useState<PaymentMethod>("card");
  const [amount, setAmount] = useState("");
  const [receivedOn, setReceivedOn] = useState(today);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  return (
    <DetailDrawer
      open
      onClose={onClose}
      title="Record payment"
      description="Never enter a card number. Use the last 4 digits or a confirmation code as the reference."
    >
      <form
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const cents = dollarsToCents(amount);
          if (cents === null || cents <= 0)
            return setError("Enter an amount greater than $0.");
          if (!receivedOn) return setError("Enter the date received.");
          try {
            setError("");
            await onSave({
              method,
              amountCents: cents,
              receivedOn,
              reference: reference.trim(),
              note: note.trim(),
            });
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <div className="form-grid">
          <FormField label="Method">
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            >
              {paymentMethods.map((m) => (
                <option key={m} value={m}>
                  {paymentMethodLabels[m]}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Amount ($)">
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </FormField>
          <FormField label="Date received">
            <input
              type="date"
              value={receivedOn}
              onChange={(e) => setReceivedOn(e.target.value)}
            />
          </FormField>
          <FormField label="Reference">
            <input
              value={reference}
              maxLength={100}
              onChange={(e) => setReference(e.target.value)}
            />
          </FormField>
        </div>
        <FormField label="Note">
          <textarea
            rows={2}
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
          />
        </FormField>
        <div className="form-actions">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Record payment</Button>
        </div>
      </form>
    </DetailDrawer>
  );
}
