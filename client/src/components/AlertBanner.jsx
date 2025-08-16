// client/src/components/AlertBanner.jsx
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import styled from 'styled-components';

const Banner = styled.div`
  background: #ffe8e8; color: #900;
  padding: 1rem 2rem; border-left: 4px solid #f00; margin: 1rem 0;
`;

export default function AlertBanner() {
  const [alert, setAlert] = useState(null);

  useEffect(() => {
    axios.get('/api/insights/overspend').then(r => {
      if (r.data.alert) setAlert(r.data.message);
    });
  }, []);

  if (!alert) return null;
  return <Banner>⚠️ {alert}</Banner>;
}
