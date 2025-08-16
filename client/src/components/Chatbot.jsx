// client/src/components/Chatbot.jsx

import React, { useState, useEffect, useRef } from "react";
import styled from "styled-components";
import api from "../utils/api";

const Container = styled.div`
  max-width: 600px;
  margin: 2rem auto;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  height: 70vh;
  overflow: hidden;
`;

const Header = styled.div`
  background-color: #0070f3;
  padding: 1rem 1.5rem;
  color: #ffffff;
  font-size: 1.25rem;
  font-weight: 600;
  border-top-left-radius: 12px;
  border-top-right-radius: 12px;
`;

const Messages = styled.div`
  flex: 1;
  padding: 1rem;
  overflow-y: auto;
  background-color: #f5f7fa;
`;

const MessageBubble = styled.div`
  max-width: 75%;
  margin-bottom: 0.75rem;
  padding: 0.75rem 1rem;
  border-radius: 12px;
  font-size: 0.95rem;
  line-height: 1.4;
  background-color: ${({ from }) =>
    from === "bot" ? "#e0e7ff" : "#d1fae5"};
  color: ${({ from }) => (from === "bot" ? "#1e293b" : "#064e3b")};
  align-self: ${({ from }) => (from === "bot" ? "flex-start" : "flex-end")};
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
`;

const InputFooter = styled.form`
  display: flex;
  border-top: 1px solid #e2e8f0;
  padding: 0.75rem 1rem;
  background-color: #ffffff;
`;

const TextInput = styled.input`
  flex: 1;
  padding: 0.75rem 1rem;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  font-size: 1rem;
  margin-right: 0.75rem;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;

  &:focus {
    border-color: #0070f3;
    outline: none;
    box-shadow: 0 0 0 3px rgba(0, 112, 243, 0.25);
  }
`;

const SendButton = styled.button`
  background-color: #0070f3;
  color: #ffffff;
  padding: 0 1.25rem;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  cursor: pointer;
  transition: background-color 0.2s ease, transform 0.1s ease;

  &:hover {
    background-color: #005bb5;
  }
  &:active {
    transform: scale(0.97);
  }
  &:disabled {
    background-color: #94a3b8;
    cursor: not-allowed;
  }
`;

export default function Chatbot() {
  // Derive current month (YYYY-MM)
  const today = new Date();
  const [month] = useState(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`
  );

  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);

  // Scroll to bottom whenever msgs changes
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [msgs]);

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;

    // 1) Fetch planner data for this month
    let planner = { month, budget: 0, futureExpenses: [] };
    try {
      const planRes = await api.get(`/planner/${month}`);
      planner = planRes.data;
    } catch (err) {
      console.error("Could not load planner data:", err);
    }

    // 2) Append user message
    const userMsg = { from: "you", text: text.trim() };
    setMsgs((prev) => [...prev, userMsg]);
    const messageText = text.trim();
    setText("");
    setSending(true);

    // 3) Send to advisor, passing planner
    try {
      const res = await api.post(`${process.env.REACT_APP_BACKEND_URL}/advisor/chat`, {
        message: messageText,
        planner,
      });
      const botReply = res.data.tips || res.data.answer || "No response.";
      setMsgs((prev) => [...prev, { from: "bot", text: botReply }]);
    } catch (err) {
      console.error("Chatbot error:", err);
      setMsgs((prev) => [
        ...prev,
        { from: "bot", text: "Sorry, something went wrong." },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <Container>
      <Header>Budget AI Assistant</Header>
      <Messages>
        {msgs.map((m, i) => (
          <MessageBubble key={i} from={m.from === "you" ? "user" : "bot"}>
            <strong>
              {m.from === "you" ? "You:" : "Assistant:"}
            </strong>{" "}
            {m.text}
          </MessageBubble>
        ))}
        <div ref={messagesEndRef} />
      </Messages>

      <InputFooter onSubmit={send}>
        <TextInput
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask your budget assistant..."
          disabled={sending}
        />
        <SendButton type="submit" disabled={!text.trim() || sending}>
          Send
        </SendButton>
      </InputFooter>
    </Container>
  );
}

