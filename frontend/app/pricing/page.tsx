import "../_landing/landing.css";
import Link from "next/link";
import { loadPrices } from "@/app/dashboard/account/actions";
import { derivePlanDisplay } from "@/app/dashboard/account/plan-pricing";
import { Nav } from "../_landing/nav";
import { CTA, Footer } from "../_landing/sections";
import { Check } from "../_landing/icons";
import { RevealController } from "../_landing/reveal-controller";

const MONTHLY_FEATS = [
  "Claude and ChatGPT MCP access",
  "Full Strava history, synced automatically",
  "Load, recovery & trend analysis",
  "Adaptive week and race plans",
  "Cancel anytime in Stripe",
];

const INCLUDES = [
  {
    title: "AI assistant access",
    desc: "Use EvolveRun inside Claude or ChatGPT through the hosted MCP connector.",
  },
  {
    title: "Training data context",
    desc: "Activities, routes, splits, zones, and planned workouts — synced automatically from Strava.",
  },
  {
    title: "Load & trend analysis",
    desc: "Weekly volume, pace trends, HR zones, and ACWR tracked over months, not just today.",
  },
  {
    title: "Adaptive training plans",
    desc: "Generate and save week plans that bend around your life — travel, bad sleep, missed sessions.",
  },
  {
    title: "Billing control",
    desc: "Checkout and subscription management handled through Stripe. Cancel in one click.",
  },
];

export default async function PricingPage() {
  const price = derivePlanDisplay(await loadPrices());
  const annualFeats = [
    "Everything in Pro Monthly",
    `Just ~${price.yearlyPerMonth} / month`,
    "Year-round training context",
    "Cancel anytime in Stripe",
  ];
  return (
    <div className="evr-landing">
      <RevealController />
      <Nav />
      <main>
        <section className="pricing-hero">
          <div className="kicker reveal">Pricing</div>
          <h1 className="reveal d1">
            Simple pricing for training context{" "}
            <em className="grad-text">inside your AI.</em>
          </h1>
          <p className="reveal d2">
            Connect your real workouts and training history to Claude or ChatGPT
            through a secure MCP connector.
          </p>
          <div className="pricing-hero-cta reveal d3">
            <Link className="btn btn-dark btn-lg" href="/signup">
              Get started <span className="arrow">→</span>
            </Link>
            <Link className="btn btn-outline btn-lg" href="/#features">
              View integrations
            </Link>
          </div>
        </section>

        <div className="plan-grid">
          <div className="plan-card reveal">
            <div className="plan-kicker">EvolveRun</div>
            <div className="plan-name">Pro Monthly</div>
            <div className="plan-price">
              <span className="amt">{price.monthly}</span>
              <span className="per">per month</span>
            </div>
            <p className="plan-desc">
              Full EvolveRun Pro access with the flexibility to cancel anytime.
            </p>
            <ul className="plan-feats">
              {MONTHLY_FEATS.map((f) => (
                <li key={f}>
                  <Check /> {f}
                </li>
              ))}
            </ul>
            <div className="plan-cta">
              <Link
                className="btn btn-outline btn-lg"
                href="/signup"
                style={{ width: "100%", justifyContent: "center", boxSizing: "border-box" }}
              >
                Get started <span className="arrow">→</span>
              </Link>
            </div>
          </div>

          <div className="plan-card featured reveal d1">
            <div className="plan-badge">Best value</div>
            <div className="plan-kicker">EvolveRun</div>
            <div className="plan-name">Pro Annual</div>
            <div className="plan-price">
              <span className="amt">{price.yearlyTotal}</span>
              <span className="per">per year</span>
            </div>
            <p className="plan-sub">Just ~{price.yearlyPerMonth} / month</p>
            <p className="plan-desc">
              Best for athletes using AI training context throughout the season.
            </p>
            <ul className="plan-feats">
              {annualFeats.map((f) => (
                <li key={f}>
                  <Check /> {f}
                </li>
              ))}
            </ul>
            <div className="plan-cta">
              <Link
                className="btn btn-dark btn-lg"
                href="/signup"
                style={{ width: "100%", justifyContent: "center", boxSizing: "border-box" }}
              >
                Get started <span className="arrow">→</span>
              </Link>
              <p className="plan-fine">Billed securely through Stripe.</p>
            </div>
          </div>
        </div>

        <div className="what-includes">
          <p className="what-includes-head reveal">What Pro includes</p>
          <div className="include-list">
            {INCLUDES.map((item, i) => (
              <div className={"include-row reveal d" + (i % 4)} key={item.title}>
                <h4>{item.title}</h4>
                <p>{item.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <CTA />
      </main>
      <Footer />
    </div>
  );
}
