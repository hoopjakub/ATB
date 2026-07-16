import { FormEvent, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../types";

function timeLabel(at: number): string {
  const d = new Date(at);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function ChatPanel({
  messages,
  onSend,
  currentUserId,
}: {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  currentUserId: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [unread, setUnread] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const seenCount = useRef(0);

  useEffect(() => {
    if (open) {
      setUnread(0);
      seenCount.current = messages.length;
    } else if (messages.length > seenCount.current) {
      setUnread(messages.length - seenCount.current);
    }
  }, [messages, open]);

  useEffect(() => {
    if (open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, open]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSend(text);
    setText("");
  };

  return (
    <div className={`chatpanel ${open ? "chatpanel--open" : ""}`}>
      {open && (
        <div className="chatpanel__window">
          <div className="chatpanel__head">
            <span>room chat</span>
            <button className="chatpanel__close" onClick={() => setOpen(false)}>×</button>
          </div>
          <div className="chatpanel__list" ref={listRef}>
            {messages.length === 0 ? (
              <div className="chatpanel__empty">no messages yet — say something unhinged.</div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`chatpanel__msg ${m.user.id === currentUserId ? "chatpanel__msg--me" : ""}`}>
                  <span className="chatpanel__nick" style={{ color: m.user.color }}>{m.user.nick}</span>
                  <span className="chatpanel__text">{m.text}</span>
                  <span className="chatpanel__time">{timeLabel(m.at)}</span>
                </div>
              ))
            )}
          </div>
          <form className="chatpanel__form" onSubmit={submit}>
            <input
              className="input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="say something"
              maxLength={500}
            />
            <button className="btn btn--sm" type="submit" disabled={!text.trim()}>send</button>
          </form>
        </div>
      )}
      <button className="chatpanel__toggle" onClick={() => setOpen((o) => !o)}>
        💬 {open ? "close" : "chat"}
        {!open && unread > 0 && <span className="chatpanel__badge">{unread > 9 ? "9+" : unread}</span>}
      </button>
    </div>
  );
}
