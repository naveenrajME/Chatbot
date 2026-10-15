import { useEffect, useLayoutEffect, useRef } from "react";
import Message from "./Message.jsx";

export default function ChatView({ chat, busy, onRegenerate }) {
  const scrollRef = useRef(null);
  const stickRef = useRef(true);
  const messages = chat?.messages ?? [];

  // Jump to the bottom when another chat opens.
  useEffect(() => {
    stickRef.current = true;
  }, [chat?.key]);

  // Follow the streaming reply unless the user has scrolled up to read.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  return (
    <div className="messages" ref={scrollRef} onScroll={onScroll}>
      <div className="col">
        {messages.map((m, i) => (
          <Message
            key={m.localId}
            message={m}
            isLast={i === messages.length - 1}
            canRegenerate={!busy && i === messages.length - 1}
            onRegenerate={onRegenerate}
          />
        ))}
      </div>
    </div>
  );
}
