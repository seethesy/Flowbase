import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  runOfShowModeLabels,
  runOfShowModes,
  type BeoView,
  type RunOfShowMode,
} from "../../shared/beo";
import { Button } from "../components/shared";
import { beoApi } from "../services/beo";

// The BEO's schedule tables (FLOW-145), built from the event timeline (FLOW-126):
// each day's setup shifts (team, hours, activities), the Start/End/Activity/Who/
// Where table, and the optional minute-by-minute run of show. The timeline is
// edited in the Timeline section; the run of show is edited here.

type Row = { time: string; cue: string; owner: string; notes: string };

export function BeoSchedule({
  eventId,
  data,
  onChange,
}: {
  eventId: string;
  data: BeoView;
  onChange: (view: BeoView) => void;
}) {
  const { timeline, runOfShow } = data.content;
  const [draft, setDraft] = useState<{ mode: RunOfShowMode; rows: Row[] } | null>(null);
  const [error, setError] = useState("");
  const save = async () => {
    if (!draft) return;
    setError("");
    try {
      onChange(await beoApi.saveRunOfShow(eventId, draft));
      setDraft(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const setRow = (index: number, change: Partial<Row>) =>
    setDraft((d) => d && { ...d, rows: d.rows.map((row, i) => (i === index ? { ...row, ...change } : row)) });

  return (
    <>
      {timeline.map((day) => (
        <div key={day.date} className="beo-day">
          <h4>
            {day.date}
            {day.isEventDay && " · Event day"}
          </h4>
          {day.shifts.map((shift, i) => (
            <div key={i} className="beo-setup-block" data-testid="beo-setup-block">
              <strong>
                {shift.kindLabel} · {shift.startTime}–{shift.endTime}
              </strong>
              {shift.activities && <p>{shift.activities}</p>}
              <p className="muted">Team: {shift.team.join(", ") || "None assigned"}</p>
            </div>
          ))}
          {day.entries.length === 0 ? (
            <p className="muted">Nothing scheduled.</p>
          ) : (
            <table className="beo-table" aria-label={`Schedule for ${day.date}`}>
              <thead>
                <tr>
                  <th scope="col">Start</th>
                  <th scope="col">End</th>
                  <th scope="col">Activity</th>
                  <th scope="col">Who</th>
                  <th scope="col">Where</th>
                </tr>
              </thead>
              <tbody>
                {day.entries.map((entry, i) => (
                  <tr key={i}>
                    <td>{entry.startTime}</td>
                    <td>{entry.endTime}</td>
                    <td>{entry.activity}</td>
                    <td>{entry.who}</td>
                    <td>{entry.where}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}

      {runOfShow.enabled && (
        <div className="beo-run-of-show" data-testid="beo-run-of-show">
          <h4>Run of show</h4>
          {runOfShow.rows.length === 0 ? (
            <p className="muted">No cues yet.</p>
          ) : (
            <table className="beo-table" aria-label="Run of show">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Cue</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Notes</th>
                </tr>
              </thead>
              <tbody>
                {runOfShow.rows.map((row, i) => (
                  <tr key={i}>
                    <td>{row.time}</td>
                    <td>{row.cue}</td>
                    <td>{row.owner}</td>
                    <td>{row.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {data.exists && data.canEdit && (
        <div className="beo-edit">
          {draft ? (
            <form
              className="beo-run-form"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <label className="form-field">
                <span>Run of show</span>
                <select
                  value={draft.mode}
                  onChange={(e) => setDraft({ ...draft, mode: e.target.value as RunOfShowMode })}
                >
                  {runOfShowModes.map((mode) => (
                    <option key={mode} value={mode}>
                      {runOfShowModeLabels[mode]}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted">
                Automatic turns it on at {runOfShow.threshold} guests or more (set in Settings).
              </p>
              {draft.rows.map((row, i) => (
                <div className="beo-run-row" key={i}>
                  <input
                    type="time"
                    aria-label={`Time for cue ${i + 1}`}
                    value={row.time}
                    onChange={(e) => setRow(i, { time: e.target.value })}
                    required
                  />
                  <input
                    aria-label={`Cue ${i + 1}`}
                    placeholder="Cue"
                    value={row.cue}
                    onChange={(e) => setRow(i, { cue: e.target.value })}
                    required
                  />
                  <input
                    aria-label={`Owner of cue ${i + 1}`}
                    placeholder="Owner"
                    value={row.owner}
                    onChange={(e) => setRow(i, { owner: e.target.value })}
                  />
                  <input
                    aria-label={`Notes for cue ${i + 1}`}
                    placeholder="Notes"
                    value={row.notes}
                    onChange={(e) => setRow(i, { notes: e.target.value })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove cue ${i + 1}`}
                    onClick={() => setDraft({ ...draft, rows: draft.rows.filter((_, j) => j !== i) })}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() => setDraft({ ...draft, rows: [...draft.rows, { time: "", cue: "", owner: "", notes: "" }] })}
              >
                <Plus size={14} />
                Add cue
              </Button>
              <Button type="submit">Save run of show</Button>
              <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              {error && (
                <p role="alert" className="error-message">
                  {error}
                </p>
              )}
            </form>
          ) : (
            <Button
              variant="outline"
              onClick={() => setDraft({ mode: runOfShow.mode, rows: runOfShow.rows.map((row) => ({ ...row })) })}
            >
              Edit run of show
            </Button>
          )}
        </div>
      )}
    </>
  );
}
