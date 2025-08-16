// client/src/components/Planner.jsx

import React, { useState, useEffect } from "react";
import styled from "styled-components";
import { Bar, Pie, Doughnut } from "react-chartjs-2";
import "chart.js/auto";
import api from "../utils/api";

// ─────────────────────────────────────────────────────────────────────────────
// Styled Components
// ─────────────────────────────────────────────────────────────────────────────
var category2;
const Page = styled.div`
  padding: 2rem;
  background-color: #f5f7fa;
  font-family: "Segoe UI", sans-serif;
  min-height: 100vh;
`;

const PageTitle = styled.h1`
  font-size: 2rem;
  color: #242424;
  margin-bottom: 1.5rem;
`;

const Card = styled.div`
  background: #fff;
  border-radius: 12px;
  padding: 1.5rem;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.07);
  margin-bottom: 2rem;
`;

const FormSection = styled.div`
  margin-bottom: 2rem;
`;

const SectionTitle = styled.h2`
  font-size: 1.25rem;
  color: #333;
  margin-bottom: 1rem;
`;

const Grid2 = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
  margin-bottom: 1.5rem;

  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
`;

const Grid3 = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 1rem;
  margin-bottom: 1.5rem;

  @media (max-width: 900px) {
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  }
`;

const StyledLabel = styled.label`
  display: block;
  font-size: 0.95rem;
  color: #555;
  margin-bottom: 0.5rem;
`;

const StyledInput = styled.input`
  width: 100%;
  padding: 0.75rem 1rem;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 1rem;
  background-color: #fff;
  transition: border 0.2s ease, box-shadow 0.2s ease;

  &:focus {
    border-color: #007bff;
    outline: none;
    box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.25);
  }
`;

const ExpenseRow = styled.form`
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: flex-end;
  margin-bottom: 1.5rem;
`;

const ExpenseField = styled.div`
  flex: 1 1 200px;

  @media (max-width: 600px) {
    flex: 1 1 100%;
  }
`;

const Button = styled.button`
  background-color: #007bff;
  color: #fff;
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.2s ease, transform 0.1s ease;

  &:hover {
    background-color: #0056b3;
  }
  &:active {
    transform: scale(0.97);
  }
  &:disabled {
    background-color: #94a3b8;
    cursor: not-allowed;
  }
`;

const KPIGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1rem;
  margin-bottom: 2rem;
`;

const KPIItem = styled.div`
  background: #f3f4f6;
  border-radius: 8px;
  padding: 1rem;
  text-align: center;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.05);

  h4 {
    margin: 0;
    font-size: 0.9rem;
    color: #555;
    font-weight: 500;
  }
  p {
    margin: 0.25rem 0 0;
    font-size: 1.3rem;
    font-weight: bold;
    color: #242424;
  }
`;

const TableContainer = styled.div`
  max-height: 300px;
  overflow-y: auto;
  margin-top: 1rem;
`;

const ExpenseTable = styled.table`
  width: 100%;
  border-collapse: collapse;

  th,
  td {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid #e5e7eb;
  }
  th {
    background: #f9fafb;
    text-align: left;
    font-size: 0.95rem;
    color: #444;
  }
  td {
    font-size: 0.95rem;
    color: #333;
  }
`;

const ActionRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin-top: 1.5rem;

  & > button {
    flex: 1 1 160px;
  }
`;

const ChartGrid = styled.div`
  display: grid;
  gap: 2rem;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  margin-top: 2rem;
`;

const ChartCard = styled.div`
  background: #fff;
  padding: 1rem;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
  height: 100%;

  h5 {
    margin-bottom: 1rem;
    font-size: 1.1rem;
    font-weight: 600;
    color: #333;
  }
  canvas {
    flex: 1;
    max-height: 250px;
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Planner Component
// ─────────────────────────────────────────────────────────────────────────────

export default function Planner() {
  // Initialize default month
  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(
    today.getMonth() + 1
  ).padStart(2, "0")}`;

  const [month, setMonth] = useState(defaultMonth);
  const [budget, setBudget] = useState(0);
  const [category, setCategory]= useState(null)

// 1) Keep your existing limits/expenses:
  const [limits, setLimits] = useState({
    Food: 0,
    Education: 0,
    Apparel: 0,
    Transportation: 0,
    Household: 0,
    Miscellaneous: 0,
  });
  const [expenses, setExpenses] = useState([]);

  // 2) Derive categories array & spent vs. limit arrays:
  const categories = Object.keys(limits);
  const spentValues = categories.map(cat =>
    expenses
      .filter(exp => exp.category === cat)
      .reduce((sum, exp) => sum + (exp.amount || 0), 0)
  );
  const limitValues = categories.map(cat => limits[cat] || 0);
 
  const [desc, setDesc] = useState("");
  const [amt, setAmt] = useState("");
  const [tableLoading, setTableLoading] = useState(false);


  const addExpense = async (e) => {
    e.preventDefault();
    if (!desc || !amt) return;

    setTableLoading(true);
    try {
      // Predict category
      const pResp = await fetch(`${process.env.REACT_APP_MLSERVICE_URL}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: desc }),
      });
      const pData = await pResp.json();
      category2=pData.category
      setCategory(pData.category);

      // Add locally
      const newExpense = { description: desc, amount: +amt, category:category2 };
      setExpenses((prev) => [...prev, newExpense]);

      // Reset form
      setDesc("");
      setAmt("");
    } catch (err) {
      console.error("Error predicting category:", err);
    } finally {
      setTableLoading(false);
    }
  };


  useEffect(() => {
  async function loadPlanner() {
    try {
      const res = await api.get(`${process.env.REACT_APP_BACKEND_URL}/planner/${month}`);
      setBudget(res.data.budget || 0);

      // Populate categoryLimits directly into `limits`
      if (res.data.categoryLimits) {
        setLimits(res.data.categoryLimits);
      }

      // Populate existing future expenses
      setExpenses(res.data.futureExpenses || []);
    } catch (err) {
      console.error("Error loading planner:", err);
    }
  }
  loadPlanner();
}, [month]);


  
  // Save planner (budget + limits + expenses)
  const savePlanner = async () => {
    try {
      await api.post(`${process.env.REACT_APP_BACKEND_URL}/planner`, {
        month,
        budget,
        category,
        categoryLimits: limits,
        futureExpenses: expenses,
      });
      alert("Planner saved successfully!");
    } catch (err) {
      console.error("Error saving planner:", err);
      alert("Failed to save planner.");
    }
  };

  // Recalculate forecast (trigger retrain)
  const recalculateForecast = async () => {
    try {
      const res = await api.post(`${process.env.REACT_APP_BACKEND_URL}/planner/retrain`, {
        month,
        futureExpenses: expenses,
      });
      alert(res.data.message || "Forecast recalculated.");
    } catch (err) {
      console.error("Error recalculating forecast:", err);
      alert("Failed to recalculate forecast.");
    }
  };

  // Compute derived values
  const totalFuture = expenses.reduce((sum, e) => sum + e.amount, 0);
  const remaining = budget - totalFuture;
  const percentUsed = budget > 0 ? Math.min((totalFuture / budget) * 100, 100) : 0;

  // Build category map for Pie chart
  const categoryMap = {};
  expenses.forEach((e) => {
    categoryMap[e.category] = (categoryMap[e.category] || 0) + e.amount;
  });

  // ───── Chart Data ────────────────────────────────────────────────────────────

  // 1) Bar Chart: Budget vs Planned vs Remaining
  const barData = {
    labels: ["Budget", "Planned", "Remaining"],
    datasets: [
      {
        label: "₹ Amount",
        data: [budget, totalFuture, remaining < 0 ? 0 : remaining],
        backgroundColor: ["#4caf50", "#2196f3", "#f44336"],
        borderRadius: 6,
      },
    ],
  };

  // 2) Pie Chart: Category‐Wise Expense Distribution
  const pieData = {
    labels: Object.keys(categoryMap),
    datasets: [
      {
        data: Object.values(categoryMap),
        backgroundColor: [
          "#ff6384",
          "#36a2eb",
          "#ffcd56",
          "#4bc0c0",
          "#9966ff",
          "#ff9f40",
        ],
        hoverOffset: 8,
      },
    ],
  };

   // 3) Build “data” for a grouped Bar chart:
  const barData2 = {
    labels: categories,
    datasets: [
      {
        label: 'Limit',
        data: limitValues,
        backgroundColor: '#4caf50',
      },
      {
        label: 'Upcoming expenses',
        data: spentValues,
        backgroundColor: '#f44336',
      },
    ],
  };
  // 4) (Optional) Define any options you like:
  const barOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          // you can format y-axis ticks as currency if desired:
          callback: (value) => `₹${value.toLocaleString()}`,
        },
      },
    },
    plugins: {
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const label = ctx.dataset.label || '';
            const val = ctx.parsed.y;
            return `${label}: ₹${val.toLocaleString()}`;
          },
        },
      },
      legend: {
        position: 'top',
      },
    },
  };


  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <Page>
      {/* Title */}
      <PageTitle>Budget Planner</PageTitle>

      {/* Charts */}
      <ChartGrid>
        {/* Chart 1: Budget vs Planned vs Remaining */}
        <ChartCard>
          <h5>Budget vs Planned vs Remaining</h5>
          <Bar
            data={barData}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                tooltip: {
                  callbacks: {
                    label: (ctx) => `₹${ctx.parsed.y.toLocaleString()}`,
                  },
                },
                legend: { display: false },
              },
              scales: {
                y: {
                  ticks: {
                    callback: (val) => `₹${val.toLocaleString()}`,
                  },
                },
              },
            }}
          />
        </ChartCard>

        {/* Chart 2: Category-Wise Expenses */}
        <ChartCard>
          <h5>Category-Wise Expenses</h5>
          <Pie
            data={pieData}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                tooltip: {
                  callbacks: {
                    label: (ctx) =>
                      `${ctx.label}: ₹${ctx.parsed.toLocaleString()}`,
                  },
                },
                legend: {
                  position: "bottom",
                  labels: { boxWidth: 12, padding: 12 },
                },
              },
            }}
          />
        </ChartCard>

         <ChartCard style={{ height: 300 /* or whatever height you need */ }}>
        <h5>Budget: Spent vs. Limit</h5>
        <Bar data={barData2} options={barOptions} />
      </ChartCard>
      </ChartGrid>

      {/* Form Card */}
      <Card>
        {/* Month & Total Budget */}
        <FormSection>
          <SectionTitle>General Settings</SectionTitle>
          <Grid2>
            <div>
              <StyledLabel>Month</StyledLabel>
              <StyledInput
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
            </div>
            <div>
              <StyledLabel>Total Budget (₹)</StyledLabel>
              <StyledInput
                type="number"
                min="0"
                value={budget}
                onChange={(e) => setBudget(+e.target.value)}
                required
              />
            </div>
          </Grid2>
        </FormSection>

        {/* Category Limits */}
        <FormSection>
          <SectionTitle>Category Limits (₹)</SectionTitle>
          <Grid3>
            {["Food", "Education", "Apparel", "Transportation", "Household", "Miscellaneous"].map(
              (cat) => (
                <div key={cat}>
                  <StyledLabel>{cat}</StyledLabel>
                  <StyledInput
                    type="number"
                    min="0"
                    value={limits[cat]}
                    onChange={(e) =>
                      setLimits((prev) => ({ ...prev, [cat]: +e.target.value }))
                    }
                  />
                </div>
              )
            )}
          </Grid3>
        </FormSection>

        {/* Add Expense */}
        <FormSection>
          <SectionTitle>Add an Expense</SectionTitle>
          <ExpenseRow onSubmit={addExpense}>
            <ExpenseField>
              <StyledLabel>Expense Description</StyledLabel>
              <StyledInput
                placeholder="e.g. College Fees"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                required
              />
            </ExpenseField>

            <ExpenseField>
              <StyledLabel>Amount (₹)</StyledLabel>
              <StyledInput
                placeholder="e.g. 10000"
                type="number"
                min="0"
                value={amt}
                onChange={(e) => setAmt(e.target.value)}
                required
              />
            </ExpenseField>

            <Button type="submit" disabled={tableLoading}>
              {tableLoading ? "Adding..." : "Add Expense"}
            </Button>
          </ExpenseRow>
        </FormSection>

        {/* KPI Ribbon */}
        <KPIGrid>
          <KPIItem>
            <h4>Total Budget</h4>
            <p>₹{budget.toLocaleString()}</p>
          </KPIItem>
          <KPIItem>
            <h4>Planned Spend</h4>
            <p>₹{totalFuture.toLocaleString()}</p>
          </KPIItem>
          <KPIItem>
            <h4>Remaining</h4>
            <p>₹{remaining.toLocaleString()}</p>
          </KPIItem>
        </KPIGrid>

        {/* Expense Table */}
        {expenses.length > 0 && (
          <TableContainer>
            <ExpenseTable>
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Amount (₹)</th>
                  <th>Category</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((e, i) => (
                  <tr key={i}>
                    <td>{e.description}</td>
                    <td>₹{e.amount.toLocaleString()}</td>
                    <td>{e.category}</td>
                  </tr>
                ))}
              </tbody>
            </ExpenseTable>
          </TableContainer>
        )}

        {/* Action Buttons */}
        <ActionRow>
          <Button onClick={recalculateForecast}>🔄 Recalculate Forecast</Button>
          <Button onClick={savePlanner}>💾 Save Planner</Button>
        </ActionRow>
      </Card>
    </Page>
  );
}
