import { Reveal } from "@/components/reveal";

const principles = [
  {
    t: "Local",
    d: "Runs on your hardware.",
  },
  {
    t: "Private",
    d: "Your home data stays yours.",
  },
  {
    t: "Open",
    d: "Open source and transparent.",
  },
  {
    t: "Yours",
    d: "No forced cloud. No lock-in.",
  },
];

/** Produktphilosophie-Strip — bewusst kompakt, ohne Karten. */
export function Principles() {
  return (
    <section className="border-y border-border/50 bg-[hsl(var(--surface))]">
      <div className="mx-auto max-w-6xl px-6 lg:px-10 py-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-6">
          {principles.map((p, i) => (
            <Reveal key={p.t} delay={i * 70}>
              <div className="flex items-baseline gap-3 lg:border-l lg:border-border/60 lg:pl-5">
                <span className="text-2xl font-bold tracking-tight text-foreground">{p.t}</span>
                <span className="text-sm text-muted-foreground leading-snug">{p.d}</span>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
