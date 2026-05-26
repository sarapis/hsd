"use client";

import { useState, useRef, useEffect } from "react";

/**
 * Floating chat widget for natural language service search.
 *
 * Uses a simple fetch-based streaming approach compatible with Workers AI SSE.
 * Grounded by the RAG endpoint on the Cloudflare Worker.
 */

interface Message {
  role: "user" | "assistant";
  content: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787";

export function ServiceChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
      });

      if (!response.ok) {
        throw new Error("Chat request failed");
      }

      // Handle SSE streaming from Workers AI
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = "";

      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          // Workers AI SSE format: data: {"response":"..."}
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6).trim();
              if (data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                if (parsed.response) {
                  assistantContent += parsed.response;
                  setMessages((prev) => {
                    const updated = [...prev];
                    updated[updated.length - 1] = {
                      role: "assistant",
                      content: assistantContent,
                    };
                    return updated;
                  });
                }
              } catch {
                // Not JSON — might be raw text
                if (data && data !== "[DONE]") {
                  assistantContent += data;
                  setMessages((prev) => {
                    const updated = [...prev];
                    updated[updated.length - 1] = {
                      role: "assistant",
                      content: assistantContent,
                    };
                    return updated;
                  });
                }
              }
            }
          }
        }
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry, I'm having trouble connecting right now. Please try browsing the directory directly.",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <>
      {/* Floating chat button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-110"
        style={{
          background: "var(--primary, #D4564E)",
          color: "white",
        }}
        aria-label={isOpen ? "Close chat" : "Open chat assistant"}
      >
        {isOpen ? (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        )}
      </button>

      {/* Chat panel */}
      {isOpen && (
        <div
          className="fixed bottom-24 right-6 z-50 w-96 max-w-[calc(100vw-3rem)] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          style={{
            background: "var(--background, #FFF9F0)",
            border: "1px solid var(--card-border, #e5e5e5)",
            height: "min(500px, calc(100vh - 8rem))",
          }}
        >
          {/* Header */}
          <div
            className="p-4 flex items-center gap-3"
            style={{
              background: "var(--primary, #D4564E)",
              color: "white",
            }}
          >
            <span className="text-xl">💬</span>
            <div>
              <h3 className="font-semibold text-sm">Service Finder</h3>
              <p className="text-xs opacity-90">Ask me about community resources</p>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-center py-8 opacity-60">
                <p className="text-sm">👋 Hi! I can help you find community services.</p>
                <p className="text-xs mt-2">Try: &quot;food pantries&quot; or &quot;mental health support&quot;</p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-[var(--primary,#D4564E)] text-white"
                      : "bg-[var(--section-alt,#f5f0e8)] text-[var(--foreground,#333)]"
                  }`}
                >
                  {msg.content || (isLoading && i === messages.length - 1 ? "..." : "")}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="p-3 border-t" style={{ borderColor: "var(--card-border, #e5e5e5)" }}>
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="What service are you looking for?"
                disabled={isLoading}
                className="flex-1 rounded-lg px-3 py-2 text-sm border focus:outline-none focus:ring-2"
                style={{
                  borderColor: "var(--card-border, #e5e5e5)",
                  background: "white",
                  color: "var(--foreground, #333)",
                }}
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 transition-colors"
                style={{ background: "var(--primary, #D4564E)" }}
              >
                {isLoading ? "..." : "Send"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
