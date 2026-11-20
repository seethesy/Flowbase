import { useState } from "react";
import { defaultLeadSources, type Lead } from "../../shared/leads";
import { leadsApi } from "../services/leads";
import { Button, DetailDrawer, FormField } from "../components/shared";
import { useListLabels } from "./list-fields";
import { T } from "../app/copy";

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
      title={<T id="lead-entry.new-lead-form.new-lead">New lead</T>}
      description={<T id="lead-entry.new-lead-form.log-a-lead-that-didn">{"Log a lead that didn't arrive on its own: a referral, phone call or walk-in."}</T>}
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
          <FormField label={<T id="lead-entry.new-lead-form.source">Source *</T>}>
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              {sources.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </FormField>
          <FormField label={<T id="lead-entry.new-lead-form.name">Name *</T>}>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <FormField label={<T id="lead-entry.new-lead-form.phone">Phone</T>}>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </FormField>
          <FormField label={<T id="lead-entry.new-lead-form.email">Email</T>}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </FormField>
          <FormField label={<T id="lead-entry.new-lead-form.event-date">Event date</T>}>
            <input
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
            />
          </FormField>
          <FormField label={<T id="lead-entry.new-lead-form.guests">Guests</T>}>
            <input
              inputMode="numeric"
              value={guests}
              onChange={(e) => setGuests(e.target.value)}
            />
          </FormField>
          <FormField label={<T id="lead-entry.new-lead-form.event-type">Event type</T>}>
            <input
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
            />
          </FormField>
          <FormField label={<T id="lead-entry.new-lead-form.location">Location</T>}>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </FormField>
          <FormField label={<T id="lead-entry.new-lead-form.budget">Budget ($)</T>}>
            <input
              inputMode="decimal"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </FormField>
        </div>
        <FormField label={<T id="lead-entry.new-lead-form.notes">Notes</T>}>
          <textarea
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </FormField>
        <div className="page-actions">
          <Button type="submit" disabled={saving}>
            <T id="lead-entry.new-lead-form.save-lead">Save lead</T>
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            <T id="lead-entry.new-lead-form.cancel">Cancel</T>
          </Button>
        </div>
      </form>
    </DetailDrawer>
  );
}
