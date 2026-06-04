"use client";

import { useState, useRef, useEffect } from "react";
import { Sparkles, User, Send } from "lucide-react";

interface Message {
  role: "user" | "ora";
  text: string;
}

const responses: Record<string, string> = {
  "hello": "Hi! I'm ORA. I can control your lights, climate, media, and more. What would you like?",
  "lights": "Your living room lights are at 80%. Want me to dim them or change the color?",
  "temperature": "It's currently 21°C in the living room, 19°C in the bedroom. Would you like me to adjust?",
  "good night": "Good night! I'll lock the doors, turn off all lights, set the alarm, and lower heating to 18°C. Sleep well!",
  "energy": "This week: 42.3 kWh used — 12% less than last week. Your solar panels covered 68% of consumption. Great job!",
  "movie": "Movie night! I've dimmed the living room lights to 15%, set the TV to Cinema mode, and the temperature to 21°C. Enjoy!",
  "morning": "Good morning! It's 7°C outside. I've set the heating to 21°C, your coffee machine is warming up, and I'll play your morning playlist.",
};

const fallbackResponses = [
  "I've taken care of that for you. Anything else?",
  "Done! Your home is all set.",
  "Got it. I've adjusted everything accordingly.",
  "Sure thing! Let me know if you need anything else.",
  "All done. Your home is now exactly how you want it.",
];

export function AIChatDemo() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const composerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  useEffect(() => {
    if (composerRef.current && input === "" && composerRef.current.textContent !== "") {
      composerRef.current.textContent = "";
    }
  }, [input]);

  const getResponse = (text: string): string => {
    const lower = text.toLowerCase();
    for (const [key, response] of Object.entries(responses)) {
      if (lower.includes(key)) return response;
    }
    return fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)];
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;

    setHasStarted(true);
    setMessages(prev => [...prev, { role: "user", text }]);
    setInput("");
    setIsTyping(true);

    setTimeout(() => {
      const response = getResponse(text);
      setMessages(prev => [...prev, { role: "ora", text: response }]);
      setIsTyping(false);
    }, 800 + Math.random() * 600);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.FormEvent<HTMLDivElement>) => {
    setInput(e.currentTarget.textContent ?? "");
  };

  const handleSuggestion = (text: string) => {
    setInput(text);
    setTimeout(() => {
      setMessages(prev => [...prev, { role: "user", text }]);
      setInput("");
      setIsTyping(true);
      setTimeout(() => {
        const response = getResponse(text);
        setMessages(prev => [...prev, { role: "ora", text: response }]);
        setIsTyping(false);
      }, 800 + Math.random() * 600);
    }, 100);
    setHasStarted(true);
    composerRef.current?.focus();
  };

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="rounded-2xl border border-border/20 bg-card/60 backdrop-blur-xl overflow-hidden shadow-xl shadow-black/20">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/10 bg-muted/10">
          <div className="relative">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success/50 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success" />
            </span>
          </div>
          <div>
            <p className="text-xs font-semibold text-foreground">ORA Assistant</p>
            <p className="text-[10px] text-success/70">Online — local</p>
          </div>
        </div>

        {/* Messages */}
        <div className="p-4 space-y-3 min-h-[280px] max-h-[280px] overflow-y-auto">
          {!hasStarted && (
            <div className="text-center py-8">
              <Sparkles className="h-8 w-8 text-primary/20 mx-auto mb-3" />
              <p className="text-xs text-muted-foreground mb-4">Try asking me something:</p>
              <div className="flex flex-wrap justify-center gap-1.5">
                {["lights", "temperature", "movie", "good night", "energy"].map(s => (
                  <button
                    key={s}
                    onClick={() => handleSuggestion(s)}
                    className="text-[11px] px-2.5 py-1 rounded-full border border-border/20 hover:border-primary/20 hover:bg-primary/5 text-muted-foreground hover:text-foreground transition-all"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex items-start gap-2 ${msg.role === "ora" ? "flex-row" : "flex-row-reverse"}`}
            >
              <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${msg.role === "ora" ? "bg-primary/15" : "bg-muted"}`}>
                {msg.role === "ora" ? (
                  <Sparkles className="h-3 w-3 text-primary" />
                ) : (
                  <User className="h-3 w-3 text-muted-foreground" />
                )}
              </div>
              <div className={`rounded-2xl px-3 py-2 max-w-[80%] ${
                msg.role === "ora"
                  ? "bg-primary/5 border border-primary/10 rounded-tl-sm"
                  : "bg-muted/40 rounded-tr-sm"
              }`}>
                <p className="text-xs text-foreground/80 leading-relaxed">{msg.text}</p>
              </div>
            </div>
          ))}

          {isTyping && (
            <div className="flex items-start gap-2">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15">
                <Sparkles className="h-3 w-3 text-primary" />
              </div>
              <div className="bg-primary/5 border border-primary/10 rounded-2xl rounded-tl-sm px-3 py-2">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="px-3 pb-3">
          <div className="flex items-center gap-2 rounded-full border border-border/20 bg-muted/20 px-3 py-2 focus-within:border-primary/30 transition-colors">
            <div
              ref={composerRef}
              role="textbox"
              aria-label="Ask ORA something"
              contentEditable
              suppressContentEditableWarning
              onInput={handleInput}
              onKeyDown={handleKeyDown}
              data-placeholder="Ask ORA something..."
              className="flex-1 bg-transparent text-xs text-foreground outline-none min-h-[16px] max-h-20 overflow-y-auto empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground/40"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 hover:bg-primary/25 transition-colors disabled:opacity-30"
            >
              <Send className="h-3 w-3 text-primary" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
