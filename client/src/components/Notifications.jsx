// src/components/Notifications.jsx
import React from "react";
import styled from "styled-components";

const Sidebar = styled.div`
  position: sticky;
  top: 80px; /* just below navbar */
  align-self: start;
`;

const NotificationCard = styled.div`
  background: #fff;
  border-left: 4px solid #ff6b6b; /* red for urgent */
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1rem;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.06);
`;

const DateText = styled.small`
  color: #999;
`;

const MessageText = styled.p`
  margin: 0.5rem 0 0;
  color: #333;
`;

export default function Notifications({ items }) {
  /**
   * items = [ { id, date, message }, … ]
   */
  return (
    <Sidebar>
      <h4>Notifications</h4>
      {items.map((note) => (
        <NotificationCard key={note.id}>
          <DateText>{new Date(note.date).toLocaleDateString()}</DateText>
          <MessageText>{note.message}</MessageText>
        </NotificationCard>
      ))}
    </Sidebar>
  );
}
