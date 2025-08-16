// src/components/RecentTransactions.jsx
import React from "react";
import styled from "styled-components";

const RecentContainer = styled.div`
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

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
`;

const Th = styled.th`
  text-align: left;
  padding: 0.75rem;
  font-size: 0.9rem;
  color: #444;
  border-bottom: 1px solid #eee;
`;

const Td = styled.td`
  padding: 0.75rem;
  font-size: 0.85rem;
  color: #333;
  border-bottom: 1px solid #f5f5f5;
`;

export default function RecentTransactions({ data }) {
  // `data` is an array of { _id, date, description, category, amount }
  return (
    <RecentContainer>
      <Title>Recent Transactions</Title>
      <Table>
        <thead>
          <tr>
            <Th>Date</Th>
            <Th>Description</Th>
            <Th>Category</Th>
            <Th style={{ textAlign: "right" }}>Amount (₹)</Th>
          </tr>
        </thead>
        <tbody>
          {data.map((txn) => (
            <tr key={txn._id}>
              <Td>{new Date(txn.date).toLocaleDateString()}</Td>
              <Td>{txn.description}</Td>
              <Td>{txn.category}</Td>
              <Td style={{ textAlign: "right" }}>
                {txn.amount.toLocaleString()}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </RecentContainer>
  );
}
