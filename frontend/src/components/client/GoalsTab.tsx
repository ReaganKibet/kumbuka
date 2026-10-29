import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../api";
import type { Goal } from "../../types";
import { ErrorText, Loading } from "../ui";

function GoalRow({ goal, onChange, onDelete }: { goal: Goal; onChange: (g: Goal) => void; onDelete: () => void }) {
  const [progress, setProgress] = useState(goal.progress);
  const update = async (b: Partial<Goal>) => onChange(await api.updateGoal(goal.id, b));
  const muted = goal.status !== "active";

  return (
    <li className={`rounded-lg bg-paper p-4 ring-1 ring-line ${muted ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className={`note-text flex-1 ${goal.status === "dropped" ? "line-through" : ""}`}>{goal.description}</p>
        <select
          className="field w-auto py-1 text-sm" value={goal.status} aria-label="Goal status"
          onChange={(e) => update({ status: e.target.value as Goal["status"] }).then(() => e.target.value === "achieved" && setProgress(100))}
        >
          <option value="active">Working on it</option>
          <option value="achieved">Achieved</option>
          <option value="dropped">Set aside</option>
        </select>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <input
          type="range" min={0} max={100} step={10} value={progress} className="flex-1 accent-pine"
          aria-label="Progress" disabled={goal.status !== "active"}
          onChange={(e) => setProgress(Number(e.target.value))}
          onPointerUp={() => progress !== goal.progress && update({ progress })}
          onKeyUp={() => progress !== goal.progress && update({ progress })}
        />
        <span className="w-10 text-right text-sm tabular-nums text-muted">{progress}%</span>
        <button className="text-xs text-muted hover:text-risk" onClick={onDelete}>Delete</button>
      </div>
    </li>
  );
}

export default function GoalsTab({ clientId }: { clientId: number }) {
  const [rows, setRows] = useState<Goal[] | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.goals(clientId).then(setRows).catch((e) => setError(e.message)); }, [clientId]);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      const g = await api.addGoal(clientId, text.trim());
      setRows((r) => [...(r ?? []), g]);
      setText("");
    } catch (err) { setError((err as Error).message); }
  }

  return (
    <div className="max-w-3xl">
      <form onSubmit={add} className="mb-6 flex gap-2">
        <input
          className="field" value={text} onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Sleep at least 7 hours on weeknights" aria-label="New goal"
        />
        <button className="btn btn-primary whitespace-nowrap">Add goal</button>
      </form>
      <ErrorText error={error} />
      {!rows && !error && <Loading />}
      {rows && rows.length === 0 && <p className="text-muted">No goals yet. Agree on one or two with the client and add them here.</p>}
      <ul className="space-y-3">
        {rows?.map((g) => (
          <GoalRow
            key={g.id} goal={g}
            onChange={(ng) => setRows((r) => r?.map((x) => (x.id === ng.id ? ng : x)) ?? null)}
            onDelete={async () => {
              if (!confirm("Delete this goal?")) return;
              await api.deleteGoal(g.id);
              setRows((r) => r?.filter((x) => x.id !== g.id) ?? null);
            }}
          />
        ))}
      </ul>
    </div>
  );
}
