import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Assessment } from "../../types";

const COLORS: Record<string, string> = { "PHQ-9": "#2f5d57", "GAD-7": "#9a6514" };

export default function ScoreChart({ rows, height = 240 }: { rows: Assessment[]; height?: number }) {
  // One row per date; each measure a separate line.
  const byDate = new Map<string, Record<string, number | string>>();
  for (const a of [...rows].sort((x, y) => x.taken_at.localeCompare(y.taken_at))) {
    const key = a.taken_at.slice(0, 10);
    const row = byDate.get(key) ?? { date: key };
    row[a.kind] = a.total;
    byDate.set(key, row);
  }
  const data = [...byDate.values()];
  const kinds = [...new Set(rows.map((r) => r.kind))];

  if (data.length < 2) {
    return <p className="text-sm text-muted">The trend appears once there are two or more questionnaires.</p>;
  }

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="#d5dcd9" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
            tick={{ fill: "#5e6f6c", fontSize: 12 }} axisLine={{ stroke: "#d5dcd9" }} tickLine={false}
          />
          <YAxis domain={[0, 27]} ticks={[0, 5, 10, 15, 20, 27]} tick={{ fill: "#5e6f6c", fontSize: 12 }} axisLine={false} tickLine={false} />
          <Tooltip
            labelFormatter={(d) => new Date(String(d)).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
            contentStyle={{ borderRadius: 6, border: "1px solid #d5dcd9", fontSize: 13 }}
          />
          <Legend wrapperStyle={{ fontSize: 13 }} />
          {kinds.map((k) => (
            <Line key={k} type="monotone" dataKey={k} stroke={COLORS[k] ?? "#1d2b2a"} strokeWidth={2.5}
              dot={{ r: 3.5, strokeWidth: 0, fill: COLORS[k] }} connectNulls isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
