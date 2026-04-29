import { useState, useEffect } from 'react'
import { api } from '../api'
import { Wallet, TrendingDown, PiggyBank, BadgePercent, Lightbulb } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts'

const CAT_COLORS = ['#4f46e5','#06b6d4','#f59e0b','#ef4444','#10b981','#8b5cf6','#ec4899','#f97316','#14b8a6','#6366f1','#78716c']

export default function Dashboard({ month }) {
  const [data, setData] = useState(null)
  const [insights, setInsights] = useState([])
  const [loadingInsights, setLoadingInsights] = useState(false)

  useEffect(() => {
    api(`/dashboard?month=${month}`).then(setData).catch(() => {})
  }, [month])

  useEffect(() => {
    setLoadingInsights(true)
    api(`/insights?month=${month}`).then(r => setInsights(r.insights || [])).catch(() => {}).finally(() => setLoadingInsights(false))
  }, [month])

  if (!data) return <div className="text-center py-20 text-gray-400">Loading...</div>

  const { budget, totalSpent, totalMRP, totalDiscount, remaining, utilization, categories, top5, weeks, nextWeekPrediction } = data

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-800">Monthly Salary Budget Summary</h2>
        <span className="text-sm text-gray-500">📅 {month}</span>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KPI icon={Wallet} label="Total Budget Allocated" value={`₹${fmt(budget.budget)}`} color="blue" />
        <KPI icon={TrendingDown} label="Total Spent Till Now" value={`₹${fmt(totalSpent)}`} sub={`(${utilization.toFixed(1)}%)`} color="orange" />
        <KPI icon={PiggyBank} label="Remaining Amount" value={`₹${fmt(remaining)}`} sub={`(${(100 - utilization).toFixed(1)}%)`} color="green" />
        <KPI icon={BadgePercent} label="Discount Saved" value={`₹${fmt(totalDiscount)}`} sub={totalMRP > 0 ? `(${((totalDiscount / totalMRP) * 100).toFixed(1)}% off)` : ''} color="purple" />
      </div>

      {/* Budget Utilization Bar */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">BUDGET UTILIZATION</h3>
        <div className="w-full bg-gray-200 rounded-full h-6 overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-500 flex items-center justify-center text-xs font-bold text-white ${utilization > 80 ? 'bg-red-500' : utilization > 60 ? 'bg-yellow-500' : 'bg-green-500'}`}
            style={{ width: `${Math.min(utilization, 100)}%` }}>
            {utilization.toFixed(1)}%
          </div>
        </div>
        <div className="flex justify-between mt-2 text-xs text-gray-500">
          <span>₹{fmt(totalSpent)} Spent</span>
          <span>₹{fmt(remaining)} Remaining</span>
        </div>
        <div className="text-center text-xs text-gray-400 mt-1">₹{fmt(budget.budget)} Budget</div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Category Breakdown */}
        <div className="bg-white rounded-xl p-4 sm:p-5 shadow-sm border border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">CATEGORY-WISE SPEND</h3>
          {categories.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={categories} layout="vertical" margin={{ left: 80 }}>
                <XAxis type="number" tickFormatter={v => `₹${v}`} />
                <YAxis type="category" dataKey="category" tick={{ fontSize: 12 }} width={80} />
                <Tooltip formatter={v => `₹${fmt(v)}`} />
                <Bar dataKey="total" radius={[0, 4, 4, 0]}>
                  {categories.map((_, i) => <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-gray-400 text-center py-10">No data yet</p>}
          {/* Category table */}
          <div className="mt-4 space-y-2">
            {categories.map((c, i) => (
              <div key={c.category} className="flex items-center gap-3 text-sm">
                <div className="w-3 h-3 rounded-full" style={{ background: CAT_COLORS[i % CAT_COLORS.length] }} />
                <span className="flex-1 text-gray-700">{c.category}</span>
                <span className="font-medium">₹{fmt(c.total)}</span>
                <span className="text-gray-400 w-16 text-right">{c.percent}%</span>
              </div>
            ))}
            <div className="flex items-center gap-3 text-sm font-bold border-t pt-2">
              <div className="w-3 h-3" />
              <span className="flex-1">TOTAL</span>
              <span>₹{fmt(totalSpent)}</span>
              <span className="w-16 text-right">100%</span>
            </div>
          </div>
        </div>

        {/* Top 5 + Spend vs MRP */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">TOP 5 HIGHEST SPEND ITEMS</h3>
            <div className="space-y-3">
              {top5.map((item, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white ${['bg-green-500','bg-blue-500','bg-yellow-500','bg-purple-500','bg-pink-500'][i]}`}>{i + 1}</span>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-800">{item.product_name}</div>
                    <div className="text-xs text-indigo-500">{item.category}</div>
                  </div>
                  <span className="font-semibold text-gray-800">₹{fmt(item.amount)}</span>
                </div>
              ))}
              {top5.length === 0 && <p className="text-gray-400 text-center py-4">No expenses yet</p>}
            </div>
          </div>

          {/* Spend vs MRP */}
          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">SPEND vs MRP SUMMARY</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-600">Total MRP</span><span className="font-medium">₹{fmt(totalMRP)}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Total Spent</span><span className="font-medium">₹{fmt(totalSpent)}</span></div>
              <div className="flex justify-between border-t pt-2"><span className="text-green-600 font-medium">Total Discount Saved</span><span className="font-bold text-green-600">₹{fmt(totalDiscount)} ({totalMRP > 0 ? ((totalDiscount / totalMRP) * 100).toFixed(1) : 0}%)</span></div>
            </div>
          </div>

          {/* Expected Expense Card */}
          <ExpectedExpenseCard budget={budget} totalSpent={totalSpent} month={month} expenseCount={data.expenseCount} />
        </div>
      </div>

      {/* Weekly Forecast */}
      <div className="bg-white rounded-xl p-4 sm:p-5 shadow-sm border border-gray-100">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">WEEK-WISE SPEND FORECAST & COVERAGE</h3>
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[600px]">
          <thead>
            <tr className="bg-indigo-900 text-white">
              <th className="py-2 px-3 text-left rounded-tl-lg">Week</th>
              <th className="py-2 px-3 text-left">Date Range</th>
              <th className="py-2 px-3 text-right">Forecasted (₹)</th>
              <th className="py-2 px-3 text-right">Actual (₹)</th>
              <th className="py-2 px-3 text-right">Variance (₹)</th>
              <th className="py-2 px-3 text-center rounded-tr-lg">Status</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map(w => (
              <tr key={w.week} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2.5 px-3 flex items-center gap-2">
                  <StatusDot status={w.status} />Week {w.week}
                </td>
                <td className="py-2.5 px-3 text-gray-600">{w.dateRange}</td>
                <td className="py-2.5 px-3 text-right">₹{fmt(w.forecast)}</td>
                <td className="py-2.5 px-3 text-right">₹{fmt(w.actual)}</td>
                <td className={`py-2.5 px-3 text-right font-medium ${w.variance >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                  {w.variance >= 0 ? '+' : ''}₹{fmt(w.variance)}
                </td>
                <td className="py-2.5 px-3 text-center">
                  <StatusBadge status={w.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {/* AI Insights */}
      {nextWeekPrediction ? (
        <div className="bg-gradient-to-r from-indigo-50 to-blue-50 rounded-xl p-5 border border-indigo-200 shadow-sm">
          <h3 className="text-sm font-semibold text-indigo-800 mb-4 flex items-center gap-2">
            🎯 NEXT WEEK TARGET — Week {nextWeekPrediction.week} ({nextWeekPrediction.dateRange})
          </h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-white rounded-lg p-4 text-center">
              <div className="text-xs text-gray-500 mb-1">Predicted Spend</div>
              <div className="text-xl font-bold text-indigo-700">₹{fmt(nextWeekPrediction.predicted)}</div>
              <div className="text-xs text-gray-400 mt-1">Based on {nextWeekPrediction.basedOnWeeks} week{nextWeekPrediction.basedOnWeeks > 1 ? 's' : ''} data</div>
            </div>
            <div className="bg-white rounded-lg p-4 text-center">
              <div className="text-xs text-gray-500 mb-1">Spending Trend</div>
              <div className={`text-xl font-bold ${nextWeekPrediction.trend === 'up' ? 'text-red-500' : nextWeekPrediction.trend === 'down' ? 'text-green-500' : 'text-gray-500'}`}>
                {nextWeekPrediction.trend === 'up' ? '📈' : nextWeekPrediction.trend === 'down' ? '📉' : '➡️'} {nextWeekPrediction.trend === 'stable' ? 'Stable' : `₹${fmt(nextWeekPrediction.trendAmount)}`}
              </div>
              <div className="text-xs text-gray-400 mt-1">{nextWeekPrediction.trend === 'up' ? 'Increasing vs last week' : nextWeekPrediction.trend === 'down' ? 'Decreasing vs last week' : 'No change'}</div>
            </div>
            <div className="bg-white rounded-lg p-4 text-center">
              <div className="text-xs text-gray-500 mb-1">End-of-Month Projection</div>
              <div className={`text-xl font-bold ${nextWeekPrediction.willExceedBudget ? 'text-red-500' : 'text-green-600'}`}>₹{fmt(nextWeekPrediction.endOfMonthProjection)}</div>
              <div className="text-xs text-gray-400 mt-1">{nextWeekPrediction.willExceedBudget ? `⚠️ Over budget by ₹${fmt(nextWeekPrediction.overBy)}` : '✅ Within budget'}</div>
            </div>
            <div className="bg-white rounded-lg p-4 text-center">
              <div className="text-xs text-gray-500 mb-1">Top Category</div>
              <div className="text-lg font-bold text-gray-700">{nextWeekPrediction.topCategory}</div>
              <div className="text-xs text-gray-400 mt-1">Highest spend area</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-gradient-to-r from-amber-50 to-yellow-50 rounded-xl p-6 border border-amber-200 shadow-sm text-center">
          <div className="text-3xl mb-3">📊</div>
          <h3 className="text-sm font-semibold text-amber-800 mb-2">NEXT WEEK FORECAST — Not Enough Data Yet</h3>
          <p className="text-sm text-amber-700 max-w-md mx-auto">We need at least one full week of expenses to predict your next week's spending. Keep tracking your daily expenses and the forecast will appear automatically!</p>
          <div className="flex justify-center gap-6 mt-4 text-xs text-amber-600">
            <span>💡 Tip: Upload past receipts to build history faster</span>
          </div>
        </div>
      )}

      {/* AI Insights */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <Lightbulb size={16} className="text-yellow-500" /> QUICK INSIGHTS (AI-Powered)
        </h3>
        {loadingInsights ? (
          <div className="text-center py-6 text-gray-400">🤖 Generating insights...</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {insights.map((ins, i) => (
              <div key={i} className="flex gap-3 p-3 bg-gray-50 rounded-lg">
                <span className="text-xl">{ins.icon || '💡'}</span>
                <div>
                  <div className="text-sm font-medium text-gray-800">{ins.title}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{ins.text}</div>
                </div>
              </div>
            ))}
            {insights.length === 0 && <p className="text-gray-400 col-span-2 text-center py-4">Set a budget and add expenses to get AI insights</p>}
          </div>
        )}
      </div>
    </div>
  )
}

function KPI({ icon: Icon, label, value, sub, color }) {
  const colors = { blue: 'bg-blue-50 text-blue-600 border-blue-200', orange: 'bg-orange-50 text-orange-600 border-orange-200', green: 'bg-green-50 text-green-600 border-green-200', purple: 'bg-purple-50 text-purple-600 border-purple-200' }
  return (
    <div className={`rounded-xl p-3 sm:p-4 border ${colors[color]} shadow-sm`}>
      <div className="flex items-center justify-between mb-1 sm:mb-2">
        <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-wide opacity-80">{label}</span>
        <Icon size={16} />
      </div>
      <div className="text-lg sm:text-2xl font-bold">{value}</div>
      {sub && <div className="text-xs mt-1 opacity-70">{sub}</div>}
    </div>
  )
}

function StatusBadge({ status }) {
  const s = { covered: 'bg-green-100 text-green-700', in_progress: 'bg-yellow-100 text-yellow-700', upcoming: 'bg-gray-100 text-gray-500' }
  const labels = { covered: 'COVERED', in_progress: 'IN PROGRESS', upcoming: 'UPCOMING' }
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s[status] || s.upcoming}`}>{labels[status] || status}</span>
}

function StatusDot({ status }) {
  const c = { covered: 'bg-green-500', in_progress: 'bg-yellow-500', upcoming: 'bg-gray-300' }
  return <span className={`w-2.5 h-2.5 rounded-full ${c[status] || c.upcoming}`} />
}

function ExpectedExpenseCard({ budget, totalSpent, month, expenseCount }) {
  const [year, mon] = month.split('-').map(Number)
  const daysInMonth = new Date(year, mon, 0).getDate()
  const today = new Date()
  const currentDay = today.getFullYear() === year && today.getMonth() + 1 === mon ? today.getDate() : daysInMonth
  const daysLeft = Math.max(daysInMonth - currentDay, 0)
  const avgDaily = currentDay > 0 && expenseCount > 0 ? totalSpent / currentDay : 0
  const projected = Math.round(avgDaily * daysInMonth)
  const dailyBudget = budget.budget > 0 ? Math.round((budget.budget - totalSpent) / Math.max(daysLeft, 1)) : 0
  const onTrack = budget.budget > 0 && projected <= budget.budget

  return (
    <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-5 shadow-sm text-white">
      <h3 className="text-xs font-semibold text-slate-400 mb-3 uppercase tracking-wide">📅 Expected Expense Tracker</h3>
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-sm text-slate-300">Avg. Daily Spend</span>
          <span className="text-lg font-bold">₹{fmt(Math.round(avgDaily))}<span className="text-xs text-slate-400">/day</span></span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-slate-300">Projected Month-End</span>
          <span className={`text-lg font-bold ${onTrack ? 'text-green-400' : 'text-red-400'}`}>₹{fmt(projected)}</span>
        </div>
        {budget.budget > 0 && daysLeft > 0 && (
          <div className="flex justify-between items-center">
            <span className="text-sm text-slate-300">Safe to Spend/Day</span>
            <span className={`text-lg font-bold ${dailyBudget > 0 ? 'text-emerald-400' : 'text-red-400'}`}>₹{fmt(Math.max(dailyBudget, 0))}<span className="text-xs text-slate-400">/day</span></span>
          </div>
        )}
        <div className="flex justify-between items-center text-xs text-slate-400 border-t border-slate-700 pt-2">
          <span>Day {currentDay} of {daysInMonth}</span>
          <span>{daysLeft} days left</span>
        </div>
      </div>
    </div>
  )
}

function fmt(n) { return Number(n || 0).toLocaleString('en-IN') }
