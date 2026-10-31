import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Assessment } from "../../types";

// Validated categorical pair (CVD-safe against the paper surface); fixed order, never cycled.
const COLORS: Record<string, string> = { "PHQ-9": "#00876f", "GAD-7": "#a85c00", "WHO-5": "#00876f" };
const LABELS: Record<string, string> = { "PHQ-9": "PHQ-9 (low mood)", "GAD-7": "GAD-7 (anxiety)", "WHO-5": "WHO-5 (wellbeing)" };

const fmtTick = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function Chart({ rows, kinds, domain, ticks, height, note }: {
  rows: Assessment[]; kinds: string[]; domain: [number, number]; ticks: number[]; height: number; note: string;
}) {
  const byDate = new Map<string, Record<string, number | string>>();
  for (const a of [...rows].filter((r) => kinds.includes(r.kind)).sort((x, y) => x.taken_at.localeCompare(y.taken_at))) {
    const key = a.taken_at.slice(0, 10);
    const row = byDate.get(key) ?? { date: key };
    row[a.kind] = a.total;
    byDate.set(key, row);
  }
  const data = [...byDate.values()];
  const present = kinds.filter((k) => rows.some((r) => r.kind === k));
  if (data.length < 2) return null;
  return (
    <figure>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="#e3e8e6" vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmtTick} tick={{ fill: "#5e6f6c", fontSize: 12 }} axisLine={{ stroke: "#d5dcd9" }} tickLine={false} />
            <YAxis domain={domain} ticks={ticks} tick={{ fill: "#5e6f6c", fontSize: 12 }} axisLine={false} tickLine={false} />
            <Tooltip
              labelFormatter={(d) => new Date(String(d)).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
              formatter={(v, k) => [v, LABELS[String(k)] ?? k]}
              contentStyle={{ borderRadius: 6, border: "1px solid #d5dcd9", fontSize: 13 }}
            />
            {present.length > 1 && <Legend wrapperStyle={{ fontSize: 13 }} formatter={(k) => <span style={{ color: "#1d2b2a" }}>{LABELS[k] ?? k}</span>} />}
            {present.map((k) => (
              <Line key={k} type="monotone" dataKey={k} stroke={COLORS[k]} strokeWidth={2}
                dot={{ r: 4, strokeWidth: 2, stroke: "#fbfcfb", fill: COLORS[k] }} activeDot={{ r: 5 }}
                connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-1 text-xs text-muted">{present.length === 1 ? `${LABELS[present[0]]}. ` : ""}{note}</figcaption>
    </figure>
  );
}

export default function ScoreChart({ rows, height = 240 }: { rows: Assessment[]; height?: number }) {
  const symptoms = rows.filter((r) => r.kind === "PHQ-9" || r.kind === "GAD-7");
  const wellbeing = rows.filter((r) => r.kind === "WHO-5");
  const enough = (rs: Assessment[]) => new Set(rs.map((r) => r.taken_at.slice(0, 10))).size >= 2;
  if (!enough(symptoms) && !enough(wellbeing)) {
    return <p className="text-sm text-muted">The trend appears once there are two or more questionnaires on different days.</p>;
  }
  return (
    <div className="space-y-6">
      {enough(symptoms) && (
        <Chart rows={symptoms} kinds={["PHQ-9", "GAD-7"]} domain={[0, 27]} ticks={[0, 5, 10, 15, 20, 27]} height={height}
          note="Lower is better. 10 or more is the usual threshold for further assessment." />
      )}
      {enough(wellbeing) && (
        <Chart rows={wellbeing} kinds={["WHO-5"]} domain={[0, 100]} ticks={[0, 28, 50, 100]} height={Math.round(height * 0.8)}
          note="Higher is better. 50 or below suggests poor wellbeing." />
      )}
    </div>
  );
}
