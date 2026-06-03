"use client";

import { useState, useEffect, useRef } from "react";
import { Sparkles, User, Cpu } from "lucide-react";

interface Message {
  role: "user" | "ora";
  text: string;
}

const conversation: Message[] = [
  { role: "user", text: "Hey ORA, I'm heading to bed." },
  { role: "ora", text: "Good night! I'll lock the doors, turn off all lights, set the alarm, and lower the heating to 18°C. Sleep well!" },
  { role: "user", text: "Perfect, and wake me up at 7 with the lights." },
  { role: "ora", text: "Done. Your bedroom lights will gradually brighten starting at 6:45. Coffee machine will start at 6:55. I'll also play your morning playlist." },
];

export function AIChatDemo() {
  const [visibleMessages, setVisibleMessages] = useState<number>(0);
  const [isTyping, setIsTyping] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    let idx = 0;
    const showNext = () => {
      if (idx < conversation.length) {
        setIsTyping(true);
        setTimeout(() => {
          setIsTyping(false);
          setVisibleMessages(++idx);
        }, 600 + Math.random() * 400);
      }
    };

    // Initial delay then start
    const start = setTimeout(showNext, 1500);
    intervalRef.current = setInterval(() => {
      if (idx >= conversation.length) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        // Restart after pause
        setTimeout(() => {
          setVisibleMessages(0);
          idx = 0;
          const restart = setTimeout(showNext, 800);
          intervalRef.current = setInterval(() => {
            if (idx >= conversation.length) {
              if (intervalRef.current) clearInterval(intervalRef.current);
              return;
            }
            showNext();
          }, 2800);
        }, 4000);
        return;
      }
      showNext();
    }, 2800);

    return () => {
      clearTimeout(start);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="rounded-2xl border border-border/30 bg-card/40 backdrop-blur-xl overflow-hidden">
        {/* Chat header */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border/20 bg-muted/20">
          <div className="relative">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-accent shadow-lg shadow-primary/20">
              <Sparkles className="h-4.5 w-4.5 text-white" />
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success/60 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-success"></span>
            </span>
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">ORA Assistant</p>
            <p className="text-[11px] text-success/80">Online — running locally</p>
          </div>
        </div>

        {/* Messages */}
        <div className="p-4 space-y-4 min-h-[320px]">
          {visibleMessages >= 1 && (
            <div className="flex items-start gap-2.5 animate-fade-in">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div className="bg-muted/60 rounded-2xl rounded-tl-sm px-4 py-2.5 max-w-[85%]">
                <p className="text-sm text-foreground/90">{conversation[0].text}</p>
              </div>
            </div>
          )}

          {visibleMessages >= 2 && (
            <div className="flex items-start gap-2.5 flex-row-reverse animate-fade-in">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-accent">
                <Sparkles className="h-3.5 w-3.5 text-white" />
              </div>
              <div className="bg-primary/10 border border-primary/15 rounded-2xl rounded-tr-sm px-4 py-2.5 max-w-[85%]">
                <p className="text-sm text-foreground/90">{conversation[1].text}</p>
              </div>
            </div>
          )}

          {visibleMessages >= 3 && (
            <div className="flex items-start gap-2.5 animate-fade-in">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div className="bg-muted/60 rounded-2xl rounded-tl-sm px-4 py-2.5 max-w-[85%]">
                <p className="text-sm text-foreground/90">{conversation[2].text}</p>
              </div>
            </div>
          )}

          {visibleMessages >= 4 && (
            <div className="flex items-start gap-2.5 flex-row-reverse animate-fade-in">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-accent">
                <Sparkles className="h-3.5 w-3.5 text-white" />
              </div>
              <div className="bg-primary/10 border border-primary/15 rounded-2xl rounded-tr-sm px-4 py-2.5 max-w-[85%]">
                <p className="text-sm text-foreground/90">{conversation[3].text}</p>
              </div>
            </div>
          )}

          {/* Typing indicator */}
          {isTyping && (
            <div className="flex items-start gap-2.5 flex-row-reverse animate-fade-in">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-accent">
                <Sparkles className="h-3.5 w-3.5 text-white" />
              </div>
              <div className="bg-primary/10 border border-primary/15 rounded-2xl rounded-tr-sm px-4 py-2.5">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "0ms" }}></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "150ms" }}></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "300ms" }}></span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Input bar */}
        <div className="px-4 pb-4">
          <div className="flex items-center gap-2 rounded-full border border-border/30 bg-muted/30 px-4 py-2.5">
            <input
              type="text"
              readOnly
              placeholder="Type a message..."
              className="flex-1 bg-transparent text-xs text-muted-foreground outline-none"
            />
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20">
              <Sparkles className="h-3 w-3 text-primary" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
