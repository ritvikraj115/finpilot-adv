import React, { useState } from 'react';
import api from '../utils/api';
import styled from 'styled-components';

const Form = styled.form`
  background: #ffffff;
  padding: 2rem;
  border-radius: 12px;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.06);
  display: grid;
  grid-template-columns: 2fr 1fr auto;
  gap: 1rem;
  margin-bottom: 2rem;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
  }
`;

const Input = styled.input`
  padding: 0.75rem 1rem;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 0.95rem;
  transition: border 0.2s ease, box-shadow 0.2s ease;

  &:focus {
    border-color: #2563eb;
    outline: none;
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.2);
  }
`;

const Button = styled.button`
  background-color: #2563eb;
  color: white;
  font-weight: 500;
  border: none;
  padding: 0.75rem 1.5rem;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s ease;

  &:hover {
    background-color: #1e40af;
  }

  &:active {
    transform: scale(0.98);
  }
`;

export default function ExpenseForm() {
  const [data, setData] = useState({ desc: '', amount: '' });

  const submit = async e => {
    e.preventDefault();
    await api.post(`${process.env.REACT_APP_BACKEND_URL}/transactions`, {
      description: data.desc,
      amount: parseFloat(data.amount),
    });
    setData({ desc: '', amount: '' });
    window.location.reload();
  };

  return (
    <Form onSubmit={submit}>
      <Input
        type="text"
        placeholder="Description (e.g. Grocery, Tuition)"
        value={data.desc}
        onChange={e => setData({ ...data, desc: e.target.value })}
        required
      />
      <Input
        type="number"
        placeholder="Amount (₹)"
        value={data.amount}
        onChange={e => setData({ ...data, amount: e.target.value })}
        required
      />
      <Button type="submit">Add Expense</Button>
    </Form>
  );
}

