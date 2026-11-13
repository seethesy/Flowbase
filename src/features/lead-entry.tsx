import { useState } from "react";
import { defaultLeadSources, type Lead } from "../../shared/leads";
import { leadsApi } from "../services/leads";
import { Button, DetailDrawer, FormField } from "../components/shared";
import { useListLabels } from "./list-fields";

const wholeNumber = /^\d+$/;
const dollars = /^\d+(\.\d{1,2})?$/;

// Manual lead entry (FLOW-101): a quick form for referrals, phone calls and
// walk-ins, laid out to work on a phone. Duplicate checks run when it is saved
// (FLOW-110); possible duplicates then show in the Duplicates tab.
export function NewLeadForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (lead: Lead) => void;
}) {
  const listed = useListLabels("lead_source");
  const sources = listed.length ? listed : [...defaultLeadSources];
  const [source, setSource] = useState(
    sources.find((value) => value === "Phone") ?? sources[0] ?? "",
  );
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [guests, setGuests] = useState("");
  const [location, setLocation] = useState("");
  const [eventType, setEventType] = useState("");
  const [budget, setBudget] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!source) return setError("Choose a source.");
    if (!name.trim()) return setError("Enter the lead's name.");
    if (guests.trim() && !wholeNumber.test(guests.trim()))
      return setError("Guests must be a whole number.");
    if (budget.trim() && !dollars.test(budget.trim().replace(/^\$/, "")))
      return setError("Budget must be a dollar amount.");
    setSaving(true);
    setError("");
    try {
      onCreated(
        await leadsApi.create({
          source,
          name,
          phone,
          email,
          eventDate: eventDate || null,
          guestCount: guests.trim() ? Number(guests) : null,
          location,
          eventType,
          budgetCents: budget.trim()
            ? Math.round(Number(budget.trim().replace(/^\$/, "")) * 100)
            : null,
          message,
        }),
      );
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <DetailDrawer
      open
      onClose={onClose}
      title="New lead"
      description="Log a lead that didn't arrive on its own: a referral, phone call or walk-in."
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <div className="form-grid">
          <FormField label="Source *">
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              {sources.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Name *">
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <FormField label="Phone">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </FormField>
          <FormField label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </FormField>
          <FormField label="Event date">
            <input
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
            />
          </FormField>
          <FormField label="Guests">
            <input
              inputMode="numeric"
              value={guests}
              onChange={(e) => setGuests(e.target.value)}
            />
          </FormField>
          <FormField label="Event type">
            <input
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
            />
          </FormField>
          <FormField label="Location">
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </FormField>
          <FormField label="Budget ($)">
            <input
              inputMode="decimal"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </FormField>
        </div>
        <FormField label="Notes">
          <textarea
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </FormField>
        <div className="page-actions">
          <Button type="submit" disabled={saving}>
            Save lead
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </DetailDrawer>
  );
}
