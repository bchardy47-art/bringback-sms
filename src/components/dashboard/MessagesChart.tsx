'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
  Legend,
} from 'recharts'

type ChartPoint = { date: string; sent: number; replies: number }

export function MessagesChart({ data }: { data: ChartPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="sentGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#dc2626" stopOpacity={0.15} />
            <stop offset="95%" stopColor="#dc2626" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="replyGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#16a34a" stopOpacity={0.15} />
            <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: '#9ca3af' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: '#9ca3af' }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'white',
            border: '1px solid #f0f0f0',
            borderRadius: 8,
            fontSize: 12,
          }}
          labelStyle={{ fontWeight: 600, color: '#374151' }}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
          formatter={(value) => value === 'sent' ? 'Messages Sent' : 'Replies'}
        />
        <Area
          type="monotone"
          dataKey="sent"
          stroke="#dc2626"
          strokeWidth={2}
          fill="url(#sentGrad)"
          dot={{ fill: '#dc2626', r: 3, strokeWidth: 0 }}
          activeDot={{ r: 5, strokeWidth: 0 }}
        />
        <Area
          type="monotone"
          dataKey="replies"
          stroke="#16a34a"
          strokeWidth={2}
          fill="url(#replyGrad)"
          dot={{ fill: '#16a34a', r: 3, strokeWidth: 0 }}
          activeDot={{ r: 5, strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
