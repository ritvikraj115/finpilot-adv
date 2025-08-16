// src/components/BudgetUtilization.jsx
import React from "react";
import styled from "styled-components";

const ProgressContainer = styled.div`
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  padding: 1.5rem;
  margin-top: 2rem;
`;

const Title = styled.h3`
  margin-bottom: 1rem;
  font-size: 1.2rem;
  color: #222;
`;

const CategoryBar = styled.div`
  margin-bottom: 1rem;
`;

const LabelRow = styled.div`
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.25rem;
  font-size: 0.9rem;
  color: #444;
`;

const BarBackground = styled.div`
  background: #f0f0f0;
  width: 100%;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
`;

const BarFiller = styled.div`
  background: #59a14f;
  width: ${(props) => props.percent}%;
  height: 100%;
  transition: width 0.3s ease;
`;

export default function BudgetUtilization({ budgets, spentByCategory }) {
  /**
   * Two possible shapes for `budgets`:
   * 1. Object map: { Food: 20000, Transportation: 8000, … }
   *    - Then `spentByCategory` is also a map: { Food: 12500, Transportation: 4200, … }
   *    - Render one bar per category.
   *
   * 2. Number: e.g. 80000  (this month’s total budget)
   *    - `spentByCategory` is still per‐category: { Food:12500, Transportation:4200, … }
   *    - Sum up all spent amounts and render a single “Overall Budget Utilization” bar.
   */

  // Helper: sum all values in spentByCategory
  const totalSpent =
    typeof spentByCategory === "object"
      ? Object.values(spentByCategory).reduce((sum, v) => sum + v, 0)
      : 0;

  // CASE A: budgets is a number → show single “Total Spent / Total Budget” bar
  if (typeof budgets === "number") {
    const totalBudget = budgets;
    const percent = totalBudget > 0 ? Math.min((totalSpent / totalBudget) * 100, 100) : 0;

    return (
      <ProgressContainer>
        <Title>Overall Budget Utilization</Title>
        <CategoryBar key="overall">
          <LabelRow>
            <span>Total</span>
            <span>
              ₹{totalSpent.toLocaleString()} / ₹{totalBudget.toLocaleString()}
            </span>
          </LabelRow>
          <BarBackground>
            <BarFiller percent={percent} />
          </BarBackground>
        </CategoryBar>
      </ProgressContainer>
    );
  }

  // CASE B: budgets is an object → render one bar per category
  if (budgets && typeof budgets === "object") {
    const entries = Object.entries(budgets); // [ [cat, limit], … ]

    // If no categories defined, show fallback message
    if (entries.length === 0) {
      return (
        <ProgressContainer>
          <Title>Budget Utilization</Title>
          <p style={{ padding: "1rem 0", color: "#666" }}>
            No budgets have been set yet.
          </p>
        </ProgressContainer>
      );
    }

    return (
      <ProgressContainer>
        <Title>Budget Utilization</Title>
        {entries.map(([cat, budgetAmt]) => {
          const spentAmt = spentByCategory?.[cat] || 0;
          const percent = budgetAmt > 0 ? Math.min((spentAmt / budgetAmt) * 100, 100) : 0;
          return (
            <CategoryBar key={cat}>
              <LabelRow>
                <span>{cat}</span>
                <span>
                  ₹{spentAmt.toLocaleString()} / ₹{budgetAmt.toLocaleString()}
                </span>
              </LabelRow>
              <BarBackground>
                <BarFiller percent={percent} />
              </BarBackground>
            </CategoryBar>
          );
        })}
      </ProgressContainer>
    );
  }

  // CASE C: budgets is missing or unexpected → show fallback
  return (
    <ProgressContainer>
      <Title>Budget Utilization</Title>
      <p style={{ padding: "1rem 0", color: "#666" }}>
        No budget data available.
      </p>
    </ProgressContainer>
  );
}

