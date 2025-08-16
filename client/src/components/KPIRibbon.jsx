// src/components/KPIRibbon.jsx
import React from "react";
import styled from "styled-components";

const Ribbon = styled.div`
  display: flex;
  gap: 1rem;
  margin-bottom: 2rem;
  flex-wrap: wrap;
`;

const KpiCard = styled.div`
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.08);
  padding: 1rem 1.25rem;
  flex: 1 1 180px; /* auto‐width with a minimum */
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  margin: 15px;
`;

const KpiValue = styled.span`
  font-size: 1.5rem;
  font-weight: 600;
  color: #222;
`;

const KpiLabel = styled.span`
  font-size: 0.9rem;
  color: #666;
  margin-top: 0.25rem;
`;

export default function KPIRibbon({ metrics }) {
  /**
   * metrics should be an array of objects:
   * [{ label: "Total Spend This Month", value: "₹ 28,450" }, ...]
   */
  return (
    <Ribbon>
      {metrics.map((m, idx) => (
        <KpiCard key={idx}>
          <KpiValue>{m.value}</KpiValue>
          <KpiLabel>{m.label}</KpiLabel>
        </KpiCard>
      ))}
    </Ribbon>
  );
}
