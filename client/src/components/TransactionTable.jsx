import React, { useEffect, useState } from 'react';
import api from '../utils/api';
import styled from 'styled-components';
import { io } from 'socket.io-client';
import { getSocket } from '../socket';

const Card = styled.div`
  background: #fff;
  border-radius: 12px;
  padding: 2rem;
  margin-top: 2rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
  overflow-x: auto;
`;

const Title = styled.h2`
  font-size: 1.5rem;
  color: #222;
  margin-bottom: 1.5rem;
`;

const Table = styled.table`
  width: 100%;
  border-collapse: separate;
  border-spacing: 0 0.75rem;
`;

const Th = styled.th`
  text-align: left;
  padding: 0.75rem;
  font-size: 0.95rem;
  color: #666;
`;

const Td = styled.td`
  padding: 1rem;
  font-size: 0.95rem;
  background: #f9fafb;
  border-radius: 8px;
  color: #333;
`;

const Tr = styled.tr`
  &:hover ${Td} {
    background: #eef2f7;
    transition: background 0.2s ease;
  }
`;

const Amount = styled.span`
  font-weight: bold;
  color: #2b9348;
`;

const CategoryBadge = styled.span`
  background: #edf2f7;
  color: #2d3748;
  font-size: 0.75rem;
  padding: 0.25rem 0.75rem;
  border-radius: 999px;
  font-weight: 500;
`;

export default function TransactionTable() {
  const [txns, setTxns] = useState([]);

  useEffect(() => {
    const socket = getSocket();

    let mounted = true;
    api.get('/transactions').then(r => mounted && setTxns(r.data));

    socket.on('transaction.created', (txn) => {
      setTxns(prev => prev.some(t => t.transaction_id === txn.transaction_id) ? prev : [txn, ...prev]);
    });

    socket.on('prediction', (pred) => {
      setTxns(prev => prev.map(t => t.transaction_id === pred.transaction_id ? { ...t, category: pred.predicted_category } : t));
    });

    return () => {
      socket.off('transaction.created');
      socket.off('prediction');
      mounted = false;
    };
  }, []);


  return (
    <Card>
      <Title>Recent Transactions</Title>
      <Table>
        <thead>
          <tr>
            <Th>Date</Th>
            <Th>Description</Th>
            <Th>Category</Th>
            <Th>Amount</Th>
          </tr>
        </thead>
        <tbody>
          {txns.map(t => (
            <Tr key={t._id}>
              <Td>{new Date(t.date).toLocaleDateString()}</Td>
              <Td>{t.description}</Td>
              <Td><CategoryBadge>{t.category}</CategoryBadge></Td>
              <Td><Amount>₹{t.amount.toLocaleString()}</Amount></Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

