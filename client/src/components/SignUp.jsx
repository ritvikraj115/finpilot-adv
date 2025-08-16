import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import styled from 'styled-components';
import api from '../utils/api';
import { setToken } from '../utils/auth';

const Page = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: calc(100vh - 64px);
  background: #f0f2f5;
`;

const Card = styled.div`
  background: #fff;
  padding: 3rem 2rem;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.05);
  width: 100%;
  max-width: 400px;
`;

const Title = styled.h2`
  margin-bottom: 1.5rem;
  text-align: center;
  font-size: 1.75rem;
  color: #333;
`;

const Form = styled.form`
  display: grid;
  gap: 1rem;
`;

const Input = styled.input`
  padding: 0.75rem 1rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 1rem;
  &:focus {
    border-color: #0070f3;
    outline: none;
  }
`;

const Button = styled.button`
  padding: 0.75rem;
  background: #0070f3;
  color: #fff;
  font-size: 1rem;
  font-weight: 500;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  &:hover {
    background: #005bb5;
  }
`;

const Footer = styled.div`
  margin-top: 1rem;
  text-align: center;
  font-size: 0.9rem;
  color: #555;
`;

export default function Signup() {
  const [form, setForm] = useState({ email: '', password: '' });
  const navigate = useNavigate();

  const submit = async e => {
    e.preventDefault();
    console.log(process.env.REACT_APP_BACKEND_URL);
    const res = await api.post(`${process.env.REACT_APP_BACKEND_URL}/auth/signup`, form);
    setToken(res.data.token);
    navigate('/dashboard');
  };

  return (
    <Page>
      <Card>
        <Title>Sign Up</Title>
        <Form onSubmit={submit}>
          <Input
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={e => setForm({ ...form, email: e.target.value })}
            required
          />
          <Input
            type="password"
            placeholder="Password"
            value={form.password}
            onChange={e => setForm({ ...form, password: e.target.value })}
            required
          />
          <Button type="submit">Create Account</Button>
        </Form>
        <Footer>
          Already have an account? <Link to="/login">Log In</Link>
        </Footer>
      </Card>
    </Page>
  );
}

