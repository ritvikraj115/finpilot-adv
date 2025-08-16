// src/components/Dashboard.jsx

import "../chartConfig"; // registers Chart.js elements + default options
import React, { useEffect, useState, useContext } from "react";
import { Line, Pie, Bar } from "react-chartjs-2";
import styled from "styled-components";
import api from "../utils/api";
import { commonOptions } from "../chartConfig";

import KPIRibbon from "./KPIRibbon";
import RecentTransactions from "./RecentTransactions";
import BudgetUtilization from "./BudgetUtilization";

// Layout Helpers
const PageGrid = styled.div`
  display: flex;
  justify-content: space-evenly;
  flex-wrap: wrap;        /* allow cards to wrap to next line on narrow screens */
  gap: 3rem;   
  @media (max-width: 1024px) {
    grid-template-columns: 1fr; /* collapse to one column on narrower screens */
  }
`;

const ChartGrid = styled.div`
  display: flex;
  justify-content: space-evenly;
  flex-wrap: wrap;        /* allow cards to wrap to next line on narrow screens */
  gap: 2rem;              /* consistent spacing between items */
  margin-bottom: 2rem;    /* optional bottom margin to separate from next section */
`;


const Card = styled.div`
  background-color: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  padding: 1.55rem;
  display: flex;
  flex-direction: column;
  height: 100%;
`;

const CardTitle = styled.h3`
  margin: 0 0 1rem;
  font-size: 1.35rem;
  font-weight: 500;
  color: #222;
`;

const ChartWrapper = styled.div`
  flex: 1; /* chart takes remaining vertical space */
  position: relative;
`;

export default function Dashboard() {
  // 1) State for data
  const [byCategory, setByCategory] = useState({});
  const [trend, setTrend] = useState([]);
  const [recentTransactions, setRecentTransactions] = useState([]);
  const [userBudgets, setUserBudgets] = useState({});
  const [bills, setBills] = useState([])
  // 2) On mount, fetch all needed endpoints
  useEffect(() => {
    async function loadData() {
      try {
        // a) Categories (spentByCategory)
        const resCat = await api.get(`${process.env.REACT_APP_BACKEND_URL}/insights/categories`);
        setByCategory(resCat.data);

        const resRecent = await api.get(`${process.env.REACT_APP_BACKEND_URL}/transactions/recent`);
        setRecentTransactions(resRecent.data);

        // b) Trend (monthly totals)
        const resTrend = await api.get(`${process.env.REACT_APP_BACKEND_URL}/insights/trend`);
        setTrend(resTrend.data);

        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`; // e.g., "2025-06"
        const resPlanner = await api.get(`${process.env.REACT_APP_BACKEND_URL}/planner/${currentMonth}`);
        console.log(resPlanner.data.budget)
        setUserBudgets(resPlanner.data.budget || 0);
        setBills(resPlanner.data.futureExpenses)
        // Suppose `bills` is already defined (e.g., from state or a variable)


      } catch (err) {
        console.error("Failed to load dashboard data:", err);
      }
    }
    loadData();
  }, []);

  // 3) Prepare KPI metrics
  // Example: compute “Total Spend This Month” from trend array
  const currentMonth = trend.length > 0 ? trend[trend.length - 1] : null;
  const totalSpendThisMonth = currentMonth
    ? `₹ ${currentMonth.total.toLocaleString()}`
    : "₹ 0";

  // Compute “Budget Remaining” if you have a single month budget object,
  // or simply pick a “total monthly budget” from userBudgets (adjust to your schema).
  // For example, if userBudgets = { Food:20000, Transportation:8000, … }, sum all:
  // const totalBudget = Object.values(userBudgets).reduce(
  //   (acc, val) => acc + val,
  //   0
  // );
  const spentAllCats =
    Object.values(byCategory).reduce((acc, val) => acc + val, 0) || 0;
  console.log(spentAllCats)
  const budgetRemaining = userBudgets
    ? `₹ ${(userBudgets - spentAllCats).toLocaleString()}`
    : "₹ 0";
  // Example “Avg. Daily Spend” – you could compute from trend this month divided by days so far:
  const today = new Date();
  const dayOfMonth = today.getDate();
  const avgDailySpend = currentMonth
    ? `₹ ${Math.round(currentMonth.total / dayOfMonth).toLocaleString()}`
    : "₹ 0";
  const upcomingBills = bills.length
  // // “Upcoming Bills” – just count how many notifications are due in the next 7 days:
  // const upcomingBillsCount = notifications.filter((note) => {
  //   const now = new Date();
  //   const due = new Date(note.date);
  //   const diff = (due - now) / (1000 * 60 * 60 * 24);
  //   return diff >= 0 && diff <= 7;
  // }).length;
  // const upcomingBills = `${upcomingBillsCount} Due`;

  // “Savings Progress” – example: if userBudgets has a “Savings” goal, and spentByCategory tracks “Savings”?
  // If you don’t have a dedicated savings goal, you can omit this KPI or replace with something else.
  // For now, let’s skip it or set to “N/A”
  const savingsProgress = userBudgets.Savings
    ? `${Math.round(
      ((userBudgets.Savings - (byCategory.Savings || 0)) /
        userBudgets.Savings) *
      100
    )}%`
    : "N/A";

  const kpiMetrics = [
    { label: "Total Spend This Month", value: totalSpendThisMonth },
    { label: "Budget Remaining", value: budgetRemaining },
    { label: "Avg. Daily Spend", value: avgDailySpend },
    { label: "Upcoming Bills", value: upcomingBills },
    // { label: "Savings Progress", value: savingsProgress },
  ];

  // 4) Pie Chart (Spending by Category)
  const pieData = {
    labels: Object.keys(byCategory),
    datasets: [
      {
        data: Object.values(byCategory),
        backgroundColor: [
          "#4e79a7",
          "#f28e2b",
          "#e15759",
          "#76b7b2",
          "#59a14f",
          "#edc949",
          "#af7aa1",
          "#ff9da7",
          "#9c755f",
          "#bab0ab",
        ],
        borderWidth: 0,
      },
    ],
  };
  const pieOptions = {
    ...commonOptions,
    plugins: {
      ...commonOptions.plugins,
      legend: {
        ...commonOptions.plugins.legend,
        position: "right",
        labels: { boxWidth: 12, padding: 12 },
      },
    },
    cutout: 0,
  };

  // 5) Line Chart (Monthly Trend)
  const lineData = {
    labels: trend.map((d) => d.month),
    datasets: [
      {
        label: "Total Spend",
        data: trend.map((d) => d.total),
        borderColor: "#4e79a7",
        backgroundColor: "rgba(78, 121, 167, 0.2)",
        fill: true,
        tension: 0.3,
        pointRadius: 4,
      },
    ],
  };
  const lineOptions = {
    ...commonOptions,
    scales: {
      ...commonOptions.scales,
      y: {
        ...commonOptions.scales.y,
        ticks: {
          ...commonOptions.scales.y.ticks,
          callback: (val) => `₹${val.toLocaleString()}`,
        },
      },
    },
    plugins: {
      ...commonOptions.plugins,
      tooltip: {
        ...commonOptions.plugins.tooltip,
        callbacks: {
          label: (ctx) => `₹${ctx.parsed.y.toLocaleString()}`,
        },
      },
    },
  };

  // 6) Bar Chart (Top 5 Categories)
  const sortedCats = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const barData = {
    labels: sortedCats.map(([cat]) => cat),
    datasets: [
      {
        label: "₹ Spent",
        data: sortedCats.map(([, val]) => val),
        backgroundColor: "#59a14f",
        borderRadius: 4,
      },
    ],
  };
  const barOptions = {
    ...commonOptions,
    scales: {
      x: {
        ...commonOptions.scales.x,
        ticks: {
          ...commonOptions.scales.x.ticks,
          font: { size: 13, weight: "500" },
        },
      },
      y: {
        ...commonOptions.scales.y,
        ticks: {
          ...commonOptions.scales.y.ticks,
          callback: (val) => `₹${val.toLocaleString()}`,
        },
      },
    },
    plugins: {
      ...commonOptions.plugins,
      tooltip: {
        ...commonOptions.plugins.tooltip,
        callbacks: {
          label: (ctx) => `₹${ctx.parsed.y.toLocaleString()}`,
        },
      },
    },
  };

 // Build the labels (descriptions) and data (amounts)
  const labels = bills.map((b) => b.description);
  const dataValues = bills.map((b) => b.amount);

  // 1) Data object for the horizontal Bar
  const futureExpensesData = {
    labels,
    datasets: [
      {
        label: "Amount (₹)",
        data: dataValues,
        backgroundColor: "#e15759", // you can change this color
        borderRadius: 4,
      },
    ],
  };

  // 2) Options with corrected tick‐callback
  const futureExpensesOptions = {
    ...commonOptions,
    indexAxis: "y", // render bars horizontally
    maintainAspectRatio: false,
    scales: {
      x: {
        ...commonOptions.scales.x,
        grid: {
          color: "#eee",
          borderDash: [4, 4],
        },
        ticks: {
          ...commonOptions.scales.x.ticks,
          callback: (val) => `₹${val.toLocaleString()}`,
        },
      },
      y: {
        ...commonOptions.scales.y,
        grid: {
          display: false, // no vertical grid lines behind labels
        },
        ticks: {
          ...commonOptions.scales.y.ticks,
          autoSkip: false,  // show every label, no skipping
          maxRotation: 0,   // don’t rotate; allow wrap instead
          callback: (label) => {
            // If Chart.js already provided an array (wrapped lines), return as is
            if (Array.isArray(label)) {
              return label;
            }
            // Ensure label is a string before calling split
            if (typeof label !== "string") {
              return label;
            }

            const maxCharsPerLine = 20;
            if (label.length <= maxCharsPerLine) {
              return label;
            }

            // Split into words and build multiple lines
            const words = label.split(" ");
            const lines = [];
            let currentLine = "";

            for (const word of words) {
              if ((currentLine + " " + word).trim().length > maxCharsPerLine) {
                lines.push(currentLine.trim());
                currentLine = word;
              } else {
                currentLine += " " + word;
              }
            }
            // Push the last line
            lines.push(currentLine.trim());
            return lines;
          },
        },
      },
    },
    plugins: {
      ...commonOptions.plugins,
      tooltip: {
        ...commonOptions.plugins.tooltip,
        callbacks: {
          // For a horizontal bar, the amount is in parsed.x
          label: (ctx) => `₹${ctx.parsed.x.toLocaleString()}`,
        },
      },
      legend: {
        display: false, // hide legend since there's only one dataset
      },
    },
  };


  return (
    <>
      {/* 3) KPI Ribbon */}
      <KPIRibbon metrics={kpiMetrics} />

      {/* 4) Charts + Sidebar */}
      <PageGrid>
        {/* Left (Main) */}
        <div>
          {/* 4.a) Chart Grid */}
          <ChartGrid>
            {/* Spending by Category (Pie) */}
            <Card>
              <CardTitle>Spending by Category</CardTitle>
              <ChartWrapper>
                <Pie data={pieData} options={pieOptions} />
              </ChartWrapper>
            </Card>

            {/* Monthly Trend (Line) */}
            <Card>
              <CardTitle>Monthly Trend</CardTitle>
              <ChartWrapper>
                <Line data={lineData} options={lineOptions} />
              </ChartWrapper>
            </Card>

            {/* Top 5 Categories (Bar) */}
            <Card>
              <CardTitle>Top 5 Categories</CardTitle>
              <ChartWrapper>
                <Bar data={barData} options={barOptions} />
              </ChartWrapper>
            </Card>
            <Card>
              <CardTitle>Upcoming Expenses</CardTitle>
              <ChartWrapper>
                <Bar data={futureExpensesData} options={futureExpensesOptions} />
              </ChartWrapper>
            </Card>
          </ChartGrid>
          <BudgetUtilization
            budgets={userBudgets}
            spentByCategory={byCategory}
          />

          {/* 5) Recent Transactions */}
          <RecentTransactions data={recentTransactions} />

          {/* 6) Budget Utilization */}
        </div>
      </PageGrid>
    </>
  );
}

