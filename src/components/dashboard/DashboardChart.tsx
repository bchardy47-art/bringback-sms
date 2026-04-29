'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

export interface ChartPoint {
  date: string
  sent: number
  replies: number
}

export function DashboardChart({ data }: { data: ChartPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f3f4" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: '#9ca3af' }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: '#9ca3af' }}
          tickLine={false}
          axisLine={false}
          width={36}
        />
        <Tooltip
          contentStyle={{
            fontSize: 12,
            borderRadius: 8,
            border: '1px solid #e5e7eb',
            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)',
          }}
          labelStyle={{ color: '#374151', fontWeight: 600, marginBottom: 4 }}
        />
        <Legend
          wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
          iconType="circle"
          iconSize={8}
        />
        <Line
          type="monotone"
          dataKey="sent"
          name="Messages Sent"
          stroke="#dc2626"
          strokeWidth={2}
          dot={{ fill: '#dc2626', r: 3, strokeWidth: 0 }}
          activeDot={{ r: 5, strokeWidth: 0 }}
        />
        <Line
          type="monotone"
          dataKey="replies"
          name="Replies"
          stroke="#16a34a"
          strokeWidth={2}
          dot={{ fill: '#16a34a', r: 3, strokeWidth: 0 }}
          activeDot={{ r: 5, strokeWidth: 0 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
