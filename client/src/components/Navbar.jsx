// client/src/components/Navbar.jsx
import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import styled from "styled-components";
import { isLoggedIn, clearToken } from "../utils/auth";

const Bar = styled.nav`
  display: flex;
  align-items: center;
  justify-content: space-between; /* push logout to right */
  padding: 0.75rem 2rem;
  background-color: #fafafa;
  border-bottom: 1px solid #e6e6e6;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  position: sticky;
  top: 0;
  z-index: 100;
`;

// Left group: Logo + Links
const LeftGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 2rem;
`;

// Right group: Logout button (when logged in)
const RightGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 1rem;
`;

// Placeholder for a Logo or App Title
const Logo = styled.div`
  font-size: 1.2rem;
  font-weight: 700;
  color: #0070f3;
  margin-right: 2rem;
  cursor: pointer;

  &:hover {
    opacity: 0.8;
  }
`;

const StyledLink = styled(NavLink)`
  position: relative;
  font-size: 1rem;
  font-weight: 500;
  color: #333;
  text-decoration: none;
  padding: 0.25rem 0;

  &.active {
    color: #0070f3;
  }

  &:hover {
    color: #0070f3;
  }

  /* Bottom underline on hover/active */
  &::after {
    content: "";
    position: absolute;
    bottom: -2px;
    left: 0;
    width: 0;
    height: 2px;
    background: #0070f3;
    transition: width 0.2s ease-in-out;
  }

  &:hover::after,
  &.active::after {
    width: 100%;
  }
`;

const LogoutButton = styled.button`
  background: #e00;
  color: #fff;
  border: none;
  padding: 0.5rem 1rem;
  font-weight: 500;
  font-size: 0.95rem;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s ease-in-out;
  white-space: nowrap;

  &:hover {
    background: #c00;
  }
`;

export default function Navbar() {
  const navigate = useNavigate();

  const handleLogout = () => {
    clearToken();
    navigate("/login");
  };

  return (
    <Bar>
      <LeftGroup>
        {/* Replace “MyApp” with your actual logo or brand name */}
        <Logo onClick={() => navigate("/dashboard")}>FinPilot</Logo>

        {isLoggedIn() ? (
          <>
            <StyledLink to="/dashboard">Dashboard</StyledLink>
            <StyledLink to="/transactions">Transactions</StyledLink>
            <StyledLink to="/insights">Insights</StyledLink>
            <StyledLink to="/planner">Budget Planner</StyledLink>
            <StyledLink to="/advisor">AI Advisor</StyledLink>
          </>
        ) : (
          <>
            <StyledLink to="/login">Login</StyledLink>
            <StyledLink to="/signup">Sign Up</StyledLink>
          </>
        )}
      </LeftGroup>

      {isLoggedIn() && (
        <RightGroup>
          <LogoutButton onClick={handleLogout}>Logout</LogoutButton>
        </RightGroup>
      )}
    </Bar>
  );
}


