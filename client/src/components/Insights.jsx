// client/src/components/InsightsNew.jsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { getSocket } from '../socket';
import styled from 'styled-components';

// Import only the chart‐rendering component from react-chartjs-2
import { Bar, Line } from 'react-chartjs-2';

// Import ChartJS (core) and registerable elements from 'chart.js'
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Title,
} from 'chart.js';

import api from '../utils/api';
import '../chartConfig';

// ── Register Chart.js Elements on ChartJS ───────────────────────────────────────
ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Title);

// ─── Styled Components ───────────────────────────────────────────────────────────
const Page = styled.div`
  padding: 2rem;
  background-color: #f5f7fa;
  min-height: 100vh;
`;

const Controls = styled.div`
  display: flex;
  justify-content: flex-end;
  margin-bottom: 1.5rem;
`;

const MonthInput = styled.input`
  padding: 0.5rem 0.75rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 1rem;
  background: #fff;
  &:focus {
    outline: none;
    border-color: #0070f3;
    box-shadow: 0 0 0 2px rgba(0, 112, 243, 0.2);
  }
`;

const KpiContainer = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
  margin-bottom: 2rem;
`;

const KpiCard = styled.div`
  background: #ffffff;
  padding: 1rem 1.25rem;
  border-radius: 8px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
  display: flex;
  flex-direction: column;
  justify-content: center;
`;

const KpiLabel = styled.span`
  font-size: 0.9rem;
  color: #666;
  margin-bottom: 0.25rem;
`;

const KpiValue = styled.span`
  font-size: 1.5rem;
  font-weight: 600;
  color: ${(props) => props.color || '#111'};
`;

const ChartGrid = styled.div`
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 2rem;
  margin-top: 2rem;
`;

const ChartSection = styled.div`
  background: #ffffff;
  padding: 1rem;
  border-radius: 8px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
  flex: 1 1 30%;
  min-width: 280px;
`;

const TitleBox = styled.h3`
  font-size: 1.25rem;
  margin-bottom: 1rem;
  color: #333;
`;

const AdvisorSection = styled.div`
  background: #ffffff;
  padding: 1.5rem;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  margin-top: 2rem;
  position: relative;

  &:before {
    content: '🤖 AI Advisor Insight';
    display: block;
    font-size: 1rem;
    font-weight: 600;
    color: #0070f3;
    margin-bottom: 0.75rem;
  }
`;

const AdvisorText = styled.p`
  font-size: 1rem;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  color: #333;
  background: #fcfcfc;
  border-left: 4px solid #4caf50;
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
  margin-bottom: 1rem;
  line-height: 1.6;
  transition: background 0.2s ease;

  &:hover {
    background: #f9f9f9;
  }
`;


// ─── Helper Functions ───────────────────────────────────────────────────────────
// Format rupees with commas
const formatINR = (val) => {
  if (typeof val !== 'number') return '₹—';
  return `₹${val.toLocaleString()}`;
};

// Decrement a "YYYY-MM" string by one month
const decrementMonth = (yyyyMm) => {
  const [y, m] = yyyyMm.split('-').map(Number);
  if (m === 1) {
    return `${y - 1}-${String(12).padStart(2, '0')}`;
  } else {
    return `${y}-${String(m - 1).padStart(2, '0')}`;
  }
};

// Get number of days in a given "YYYY-MM"
const daysInMonth = (yyyyMm) => {
  const [y, m] = yyyyMm.split('-').map(Number);
  return new Date(y, m, 0).getDate();
};

// ─── Main Component ────────────────────────────────────────────────────────────
export default function InsightsNew() {
  // 1) Manage Month selector
  const today = new Date();
  const socketRef = useRef(null);
  const defaultMonth = `${today.getFullYear()}-${String(
    today.getMonth() + 1
  ).padStart(2, '0')}`;
  const [month, setMonth] = useState(defaultMonth);

  // 2) Backend data
  const [planner, setPlanner] = useState({
    budget: null,
    futureExpenses: [],
    categoryLimits: {},
  });
  const [predicted, setPredicted] = useState(null);
  const [categoryThis, setCategoryThis] = useState({}); // actual spending this month by category
  const [categoryLast, setCategoryLast] = useState({}); // last month spending
  const [trend, setTrend] = useState([]); // e.g. [ {month, total}, … ]
  const [category, setByCategory] = useState([]);
  const [avgTxn, setAvgTxn] = useState();

  // 3) Derived states
  const [avgDailySpend, setAvgDailySpend] = useState(null);
  // Updated: categoryLimits vs actual spending (from categoryThis)
  const [limitVsSpendData, setLimitVsSpendData] = useState({
    labels: [],
    limit: [],
    spend: [],
  });
  const [upcomingCountData, setUpcomingCountData] = useState({
    labels: [],
    data: [],
  });
  const [upcomingHistData, setUpcomingHistData] = useState({
    labels: [],
    data: [],
  });
  const [daywise, setdaywise] = useState([])

  // 1. Change your state shape to hold { name, ratio } instead of { pctChange }
  const [topRiskCategory, setTopRiskCategory] = useState({
    name: null,
    ratio: 0,      // will store the max spent/limit ratio
  });

  // 2. Whenever `limitVsSpendData` or `category` updates, recalc the highest ratio:
  useEffect(() => {
    const labels = limitVsSpendData.labels || [];
    const limits = limitVsSpendData.limit || [];
    let maxRatio = -Infinity;
    let worstCat = null;

    labels.forEach((label, idx) => {
      const spent = category[label] != null ? category[label] : 0;
      const limit = limits[idx] != null && limits[idx] !== 0 ? limits[idx] : 0;

      if (limit === 0) {
        // If limit is zero, skip or treat as “infinite risk.” 
        // You could choose to bump it to Infinity, but here we’ll skip.
        return;
      }

      const ratio = (spent / limit) * 100;
      if (ratio > maxRatio) {
        maxRatio = ratio;
        worstCat = label;
      }
    });

    // If nothing found (e.g. no labels or all limits are zero), you can fallback to null/0
    setTopRiskCategory({
      name: worstCat,
      ratio: maxRatio > 0 && isFinite(maxRatio) ? maxRatio : 0,
    });
  }, [limitVsSpendData, category]);


  // ─── Fetch API data whenever “month” changes ─────────────────────────────────
  const loadInsights = async () => {
    try {
      // 1) /planner/:month → { budget, futureExpenses: [...], categoryLimits: {...} }
      const plRes = await api.get(`${process.env.REACT_APP_BACKEND_URL}/planner/${month}`);
      setPlanner(plRes.data);

      // 2) /insights/predict → { prediction }
      const pRes = await api.get(`${process.env.REACT_APP_BACKEND_URL}/insights/predict`);
      setPredicted(pRes.data.prediction ?? null);
      setDaywiseSafe(pRes.data.daywise ?? []);
      setAvgTxn(pRes.data.avgTxnsPerDay ?? null);
      if (pRes.data.model_run_id) setModelRunId(pRes.data.model_run_id);
      // safe setter for daywise ensuring array of numbers
      const setDaywiseSafe = (arr) => {
        if (!Array.isArray(arr)) {
          setDaywise([]);
          return;
        }
        const nums = arr.map((v) => {
          const n = Number(v);
          return Number.isNaN(n) ? 0 : n;
        });
        setDaywise(nums);
      };
      setAvgTxn(pRes.data.avgTxnsPerDay)

      const resCat = await api.get(`${process.env.REACT_APP_BACKEND_URL}/insights/categories`);
      setByCategory(resCat.data);

      // 3) /insights/categories?month=YYYY-MM  (this month’s actual spending)
      const thisCatRes = await api.get(
        `${process.env.REACT_APP_BACKEND_URL}/insights/monthlycategories?month=${month}`
      );
      setCategoryThis(thisCatRes.data);

      // 4) /insights/categories?month=LAST_MONTH  (last month spending)
      const lastMonth = decrementMonth(month);
      const lastCatRes = await api.get(`${process.env.REACT_APP_BACKEND_URL}/insights/categories?month=${lastMonth}`);
      setCategoryLast(lastCatRes.data);

      // 5) /insights/trend → [ {month, total}, … ]
      const trRes = await api.get(`${process.env.REACT_APP_BACKEND_URL}/insights/trend`);
      setTrend(trRes.data);
    } catch (err) {
      console.error('Error loading insights:', err);
    }
  };

  useEffect(() => {
    loadInsights();
  }, [month]);

  // ─── Derive additional insights when raw data updates ───────────────────────
  useEffect(() => {
    // 1) Average Daily Spend = totalSpentThisMonth ÷ daysInMonth
    const found = trend.find((d) => d.month === month);
    if (found && found.total != null) {
      const days = daysInMonth(month);
      setAvgDailySpend(found.total / days);
    } else {
      setAvgDailySpend(null);
    }
    // ─── Updated: Build Category Limit vs Spend Chart Data ────────────────
    const limits = planner.categoryLimits || {};
    const limitLabels = Object.keys(limits);
    // For each category in limits, pick actual spending from categoryThis
    const limitArr = limitLabels.map((cat) => limits[cat] || 0);
    const spendArr = limitLabels.map((cat) => categoryThis[cat] || 0);
    setLimitVsSpendData({ labels: limitLabels, limit: limitArr, spend: spendArr });

    // 3) Upcoming Expense Count by Category (unchanged)
    const countObj = {};
    for (let e of planner.futureExpenses) {
      const cat = e.category || 'Uncategorized';
      countObj[cat] = (countObj[cat] || 0) + 1;
    }
    const ucLabels = Object.keys(countObj);
    const ucData = Object.values(countObj);
    setUpcomingCountData({ labels: ucLabels, data: ucData });

    // 4) Upcoming Expense Amount Distribution (₹5,000 buckets) (unchanged)
    const amounts = planner.futureExpenses.map((e) => e.amount);
    if (amounts.length > 0) {
      const maxAmt = Math.max(...amounts);
      const bucketSize = 5000;
      const numBuckets = Math.ceil(maxAmt / bucketSize);
      const buckets = new Array(numBuckets).fill(0);
      amounts.forEach((amt) => {
        const idx = Math.min(Math.floor(amt / bucketSize), numBuckets - 1);
        buckets[idx]++;
      });
      const histLabels = buckets.map((_, i) => {
        const start = i * bucketSize;
        const end = start + bucketSize - 1;
        return `₹${start.toLocaleString()}–₹${end.toLocaleString()}`;
      });
      setUpcomingHistData({ labels: histLabels, data: buckets });
    } else {
      setUpcomingHistData({ labels: [], data: [] });
    }
  }, [planner, categoryThis, categoryLast, trend, month]);

  // ─── Chart.js Options ────────────────────────────────────────────────────────
  const limitVsSpendOptions = {
    plugins: {
      legend: { position: 'top' },
      tooltip: {
        callbacks: {
          label: (ctx) => `₹${ctx.parsed.y.toLocaleString()}`,
        },
      },
      title: {
        display: false,
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          callback: (val) => `₹${val.toLocaleString()}`,
        },
      },
    },
  };

  const upcomingCountOptions = {
    indexAxis: 'y',
    plugins: {
      legend: { display: false },
      title: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.raw} items`,
        },
      },
    },
    scales: {
      x: {
        ticks: {
          callback: (v) => `${v}`,
        },
      },
    },
  };
  const spentData = limitVsSpendData.labels.map(label => category[label] ?? 0);
  const upcomingHistOptions = {
    plugins: {
      legend: { display: false },
      title: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.raw} expense${ctx.raw > 1 ? 's' : ''}`,
        },
      },
    },
    scales: {
      x: {
        ticks: {
          autoSkip: false,
          maxRotation: 45,
          minRotation: 45,
        },
      },
      y: {
        beginAtZero: true,
        ticks: {
          callback: (v) => `${v}`,
        },
      },
    },
  };

  const [aiInsights, setAiInsights] = useState([]);
  const [loadingAi, setLoadingAi] = useState(false);
  const [aiError, setAiError] = useState(null);

  useEffect(() => {
    if (planner?.budget != null && predicted != null) {
      const fetchInsights = async () => {
        setLoadingAi(true);
        setAiError(null);

        try {
          // Pass `planner` and `message` as query params (GET cannot have a body)
          const { data } = await api.post(`${process.env.REACT_APP_BACKEND_URL}/insights/getinsights`, {
            budget: planner.budget,
            expense: planner.futureExpenses,
            limits: planner.categoryLimits
          });
          // Expecting: { insights: [ "insight1", "insight2", … ] }
          setAiInsights(Array.isArray(data.insights) ? data.insights : []);
        } catch (err) {
          console.error('Failed to fetch AI insights:', err);
          setAiError(err);
        } finally {
          setLoadingAi(false);
        }
      };

      fetchInsights();
    }
  }, [planner, predicted]);

  // --- Socket: subscribe to realtime forecast events
useEffect(() => {
  const socket = getSocket();
  socketRef.current = socket;

  const onForecast = (evt) => {
    try {
      if (!evt) return;
      // Expected shape: { event_type:'forecast', model_run_id, user_id, daywise, total, timestamp }
      if (evt.daywise) setDaywiseSafe(evt.daywise);
      if (evt.total != null) setPredicted(Number(evt.total));
      if (evt.model_run_id) setModelRunId(evt.model_run_id);
      if (evt.timestamp) setLastUpdated(evt.timestamp);
      else setLastUpdated(new Date().toISOString());
    } catch (e) {
      console.error('Error handling forecast event', e);
    }
  };

  socket.on('forecast.prediction', onForecast);
  socket.on('prediction', (payload) => {
    if (payload && payload.event_type === 'forecast') onForecast(payload);
  });

  socket.on('connect', () => {
    // optional: server may auto-join user room based on JWT
  });

  socket.on('connect_error', (err) => {
    console.warn('socket connect_error', err?.message || err);
  });

  return () => {
    if (!socket) return;
    socket.off('forecast.prediction', onForecast);
    socket.off('prediction', onForecast);
    socketRef.current = null;
  };
// eslint-disable-next-line react-hooks/exhaustive-deps
}, []);



  const renderAIAdvisorText = () => {
    // a) If budget or predicted is still undefined:
    if (planner?.budget == null || predicted == null) {
      return (
        <AdvisorText>
          We’re loading your budget and forecast data—please wait a moment for AI insights.
        </AdvisorText>
      );
    }

    // b) If the AI request is in progress:
    if (loadingAi) {
      return <AdvisorText>Loading AI insights...</AdvisorText>;
    }

    // c) If the AI request failed:
    if (aiError) {
      return (
        <AdvisorText>
          Sorry, we couldn’t load AI insights right now. Please try again later.
        </AdvisorText>
      );
    }
    // d) If we have insights from the server, map them:
    if (Array.isArray(aiInsights) && aiInsights.length > 0) {
      return aiInsights.map((insight, idx) => (
        <AdvisorText key={idx}>• {insight}</AdvisorText>
      ));
    }

    // e) Fallback: if no insights returned, show nothing (or you can revert to old text)
    return null;
  };
const adjustedShuffled = useMemo(() => {
  const base = (Array.isArray(daywise) ? daywise.slice(0, 7) : []);
  let arr;
  if (Array.isArray(base) && base.length > 0) {
    if (avgTxn != null && !Number.isNaN(Number(avgTxn))) {
      arr = base.map((amount) => Number(amount) * Number(avgTxn));
    } else {
      arr = base.map((amount) => Number(amount));
    }
  } else {
    arr = new Array(7).fill(0);
  }

  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  if (arr.length < 7) {
    const pad = new Array(7 - arr.length).fill(0);
    arr = arr.concat(pad);
  }
  return arr.slice(0, 7);
}, [daywise, avgTxn]);


  // 2) Generate the next 7 calendar dates (YYYY‑MM‑DD) in order
  const next7Dates = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() + i + 1);
      return d.toISOString().split('T')[0];
    });
  }, []);


  return (
    <Page>
      {/* ─── Month Picker ───────────────────────────────────────────────────────── */}
      <Controls>
        <MonthInput
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
      </Controls>

      {/* ─── KPI CARDS ──────────────────────────────────────────────────────────── */}
      <KpiContainer>
        {/* Planner Budget */}
        <KpiCard>
          <KpiLabel>Planner Budget</KpiLabel>
          <KpiValue color="#4caf50">
            {planner.budget != null ? formatINR(planner.budget) : '—'}
          </KpiValue>
        </KpiCard>

        {/* Total Future Expenses */}
        <KpiCard>
          <KpiLabel>Total Future Expenses</KpiLabel>
          <KpiValue color="#2196f3">
            {planner.futureExpenses.length > 0
              ? formatINR(
                planner.futureExpenses.reduce((acc, e) => acc + e.amount, 0)
              )
              : '₹0'}
          </KpiValue>
        </KpiCard>

        {/* Forecasted Spend */}
        <KpiCard>
          <KpiLabel>Forecasted Spend</KpiLabel>
          <KpiValue color="#ff9800">
            {predicted != null
              ? formatINR(parseFloat(predicted * avgTxn.toFixed(2)))
              : '—'}
          </KpiValue>
        </KpiCard>

        {/* Top‐Growing Category MoM */}
        <KpiCard>
          <KpiLabel>Max %age of category-limit spent </KpiLabel>
          {topRiskCategory.name ? (
            <div>
              <KpiValue
                color={topRiskCategory.ratio <= 80 ? '#4caf50' : '#f44336'}
              >
                {`${topRiskCategory.ratio.toFixed(1)}%`}
              </KpiValue>
              <span style={{ fontSize: '0.9rem', color: '#555' }}>
                {" " + topRiskCategory.name}
              </span>
            </div>
          ) : (
            <KpiValue>—</KpiValue>
          )}
        </KpiCard>
      </KpiContainer>

      {/* ─── Three Charts ────────────────────────────────────────────────────────── */}
      <ChartGrid>
        {/* 1) Category Limit vs Spend */}
        <ChartSection>
          <TitleBox>Category Limit vs. Spend</TitleBox>
          {limitVsSpendData.labels.length === 0 ? (
            <p style={{ color: '#555' }}>No category data available.</p>
          ) : (
            // Somewhere above in your component:


            // Then in render/return:
            <Bar
              data={{
                labels: limitVsSpendData.labels,
                datasets: [
                  {
                    label: 'Limit',
                    data: limitVsSpendData.limit,
                    backgroundColor: '#4caf50',
                  },
                  {
                    label: 'Spent',
                    data: spentData,
                    backgroundColor: '#f44336',
                  },
                ],
              }}
              options={limitVsSpendOptions}
            />

          )}
        </ChartSection>

        {/* 2) Planner vs Forecast vs Future Expenses */}
        <ChartSection>
          <TitleBox>Planner vs Forecast vs Future Exp.</TitleBox>
          {planner.budget == null || predicted == null ? (
            <p style={{ color: '#555' }}>Loading budget/forecast…</p>
          ) : (
            (() => {
              const totalFuture = planner.futureExpenses.reduce((sum, e) => sum + e.amount, 0);
              const barData = {
                labels: ['Planner Budget', 'Forecasted Spend', 'Total Future Exp.'],
                datasets: [
                  {
                    label: '₹ Amount',
                    data: [planner.budget, predicted, totalFuture],
                    backgroundColor: ['#4caf50', '#f44336', '#2196f3'],
                  },
                ],
              };
              const barOptions = {
                plugins: {
                  legend: { display: false },
                  title: { display: false },
                },
                scales: {
                  x: {
                    ticks: {
                      autoSkip: false,
                      maxRotation: 0,
                      minRotation: 0,
                    },
                  },
                  y: {
                    beginAtZero: true,
                    ticks: {
                      callback: (val) => `₹${val.toLocaleString()}`,
                    },
                  },
                },
              };
              return <Bar data={barData} options={barOptions} />;
            })()
          )}
        </ChartSection>

        {/* 3) Upcoming Expense Histogram */}
        <ChartSection style={{ height: '300px' }}>
          <TitleBox>Next 7 Predicted Transaction Amounts</TitleBox>
          {Array.isArray(daywise) && daywise.length > 0 ? (
            <Line
              data={{
                labels: next7Dates,
                datasets: [
                  {
                    label: 'Predicted Amount (₹)',
                    data: adjustedShuffled,
                    borderColor: '#2196f3',
                    backgroundColor: 'rgba(33, 150, 243, 0.2)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 4,
                    pointBackgroundColor: '#2196f3',
                  },
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                  x: {
                    title: {
                      display: true,
                      text: 'Transaction #',
                      font: { size: 14, weight: 'bold' },
                    },
                  },
                  y: {
                    beginAtZero: true,
                    title: {
                      display: true,
                      text: 'Amount (₹)',
                      font: { size: 14, weight: 'bold' },
                    },
                    ticks: {
                      callback: (val) => `₹${val.toLocaleString()}`,
                    },
                  },
                },
                plugins: {
                  tooltip: {
                    callbacks: {
                      label: (ctx) => `₹${ctx.parsed.y.toLocaleString()}`,
                    },
                  },
                  legend: {
                    display: false,
                  },
                },
              }}
            />
          ) : (
            <p style={{ color: '#555' }}>No predicted transactions available.</p>
          )}
        </ChartSection>


      </ChartGrid>

      {/* ─── AI ADVISOR INSIGHTS ───────────────────────────────────────────────── */}
      <AdvisorSection>{renderAIAdvisorText()}</AdvisorSection>
    </Page>
  );
}



