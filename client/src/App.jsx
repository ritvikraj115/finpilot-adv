// client/src/App.jsx
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Navbar      from './components/Navbar';
import PrivateRoute from './components/PrivateRoute';
import Signup      from './components/SignUp';
import Login       from './components/Login';
import Dashboard   from './components/Dashboard';
import ExpenseForm from './components/ExpenseForm';
import TransactionTable from './components/TransactionTable';
import Chatbot     from './components/Chatbot';
import Insights from './components/Insights';
import Planner from './components/Planner';

function App() {
  return (
    <>
      <Navbar />
      <Routes>
        <Route path="/signup" element={<Signup />} />
        <Route path="/login"  element={<Login />} />
        <Route path="/" element={<Navigate to="/dashboard" />} />
        <Route path="/dashboard"
          element={<PrivateRoute><Dashboard /></PrivateRoute>} />
        <Route path="/transactions"
          element={<PrivateRoute>
                     <ExpenseForm /><TransactionTable />
                   </PrivateRoute>} />
        <Route path="/advisor"
          element={<PrivateRoute><Chatbot /></PrivateRoute>} />
          <Route path="/insights" element={<PrivateRoute><Insights/></PrivateRoute>} />
           <Route path="/planner" element={<PrivateRoute><Planner/></PrivateRoute>} />
        <Route path="*" element={<div>404 Not Found</div>} />
      </Routes>
    </>
  );
}
export default App;

