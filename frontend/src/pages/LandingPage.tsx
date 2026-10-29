import {
  BarChart3,
  CalendarDays,
  Check,
  Code,
  ListChecks,
  Moon,
  ShieldCheck,
  Smartphone,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router";

import assignmentsShot from "../assets/landing/assignments.webp";
import calendarMobileShot from "../assets/landing/calendar-mobile.webp";
import calendarShot from "../assets/landing/calendar.webp";
import heroDarkShot from "../assets/landing/hero-calendar-dark.webp";
import heroShot from "../assets/landing/hero-calendar.webp";
import statsShot from "../assets/landing/stats.webp";
import studyShot from "../assets/landing/study.webp";
import { DemoButton } from "../components/DemoButton";
import { BrandMark } from "../components/Feedback";
import { usePageTitle } from "../hooks/usePageTitle";
import { SOURCE_URL } from "../lib/links";

type Feature = {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  shot: string;
  alt: string;
};

const FEATURES: Feature[] = [
  {
    icon: CalendarDays,
    eyebrow: "Calendar",
    title: "See the whole week at a glance",
    body: "Every deadline on one week view, coloured by course, so a busy Thursday stands out before it arrives.",
    points: [
      "Tick work off right on the calendar",
      "Anything overdue is collected at the top",
      "Shown in your own time zone",
    ],
    shot: calendarShot,
    alt: "The StudyFlow calendar: a week of assignments, coloured by course",
  },
  {
    icon: ListChecks,
    eyebrow: "Assignments",
    title: "A to-do list that knows your courses",
    body: "Assignments, labs, quizzes and exams, each with a priority and a status you can change in one click.",
    points: [
      "Filter by course, status, priority or date",
      "Filters live in the URL, so you can bookmark a view",
      "Overdue work stands out, so it can't hide",
    ],
    shot: assignmentsShot,
    alt: "The assignments list with filters for course, status and priority",
  },
  {
    icon: Timer,
    eyebrow: "Study timer",
    title: "Focus in blocks, logged for you",
    body: "Pick a course and start a 25/5 or 50/10 Pomodoro. Each finished focus block is saved to that course.",
    points: [
      "Keeps running while you switch pages, refresh or close the lid",
      "A countdown in the tab title and the top bar",
      "Log time you studied away from the app by hand",
    ],
    shot: studyShot,
    alt: "The Pomodoro timer with a course picker and this week's sessions",
  },
  {
    icon: BarChart3,
    eyebrow: "Stats",
    title: "Know where your hours actually went",
    body: "A weekly breakdown of study time per day and per course, so you can tell which class is getting ignored.",
    points: [
      "Day by day, split by course",
      "Totals per course for the week",
      "Look back at any previous week",
    ],
    shot: statsShot,
    alt: "Weekly stats: a stacked bar chart of study hours per day, by course",
  },
];

const EXTRAS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Smartphone,
    title: "Works on your phone",
    body: "A layout built for small screens, with a tab bar at the bottom.",
  },
  {
    icon: Moon,
    title: "Dark mode",
    body: "Follows your system setting, with chart colours tuned for both.",
  },
  {
    icon: ShieldCheck,
    title: "Your data stays yours",
    body: "Every request is checked against your account. Nobody else can see your courses.",
  },
  {
    icon: Code,
    title: "Open source",
    body: "FastAPI, PostgreSQL and React with TypeScript. Read every line on GitHub.",
  },
];

const STEPS = [
  { title: "Add your courses", body: "Give each one a code and a colour." },
  { title: "Add your deadlines", body: "Assignments, labs, quizzes and exams, with due dates." },
  { title: "Study and watch it add up", body: "Run the timer and see your week fill in." },
];

/** A screenshot in a simple browser frame. The size is the image's, so nothing jumps as it loads. */
function Shot({
  src,
  alt,
  darkSrc,
  width = 1300,
  height = 812,
  eager = false,
}: {
  src: string;
  alt: string;
  darkSrc?: string;
  width?: number;
  height?: number;
  eager?: boolean;
}) {
  return (
    <figure className="shot">
      <div className="shot-bar" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <picture>
        {darkSrc && <source srcSet={darkSrc} media="(prefers-color-scheme: dark)" />}
        <img
          src={src}
          alt={alt}
          width={width}
          height={height}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
        />
      </picture>
    </figure>
  );
}

/** The public front page: what StudyFlow is, what it does, and two ways in. */
export function LandingPage() {
  usePageTitle(null);

  return (
    <div className="landing">
      <header className="landing-header">
        <div className="landing-container landing-header-inner">
          <Link to="/" className="brand">
            <BrandMark />
            StudyFlow
          </Link>
          <nav className="landing-nav" aria-label="Page sections">
            <a href="#features">Features</a>
            <a href="#how-it-works">How it works</a>
            <a href={SOURCE_URL} target="_blank" rel="noreferrer">
              GitHub
            </a>
          </nav>
          <div className="landing-header-actions">
            <Link to="/login" className="btn btn-ghost btn-sm">
              Log in
            </Link>
            <Link to="/register" className="btn btn-primary btn-sm">
              Get started
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="landing-hero">
          <div className="landing-container">
            <p className="landing-eyebrow">Free and open source, built for students</p>
            <h1>Every deadline and every study hour, in one place.</h1>
            <p className="landing-lede">
              StudyFlow keeps your courses, assignments and focus time side by side, so you can see
              what's due this week and where your time actually went.
            </p>
            <div className="landing-cta">
              <DemoButton />
              <Link to="/register" className="btn btn-ghost btn-large">
                Create an account
              </Link>
            </div>
            <p className="muted landing-note">
              The demo is a sample student account with this week's data. No sign-up needed.
            </p>
            <div className="landing-hero-shot">
              <img
                className="landing-phone"
                src={calendarMobileShot}
                alt="StudyFlow's calendar on a phone"
                width={520}
                height={1125}
                decoding="async"
              />
              <Shot
                src={heroShot}
                darkSrc={heroDarkShot}
                width={1600}
                height={850}
                eager
                alt="StudyFlow's week calendar with assignments from several courses"
              />
            </div>
          </div>
        </section>

        <section id="features" className="landing-section" aria-labelledby="features-title">
          <div className="landing-container">
            <div className="landing-section-head">
              <p className="landing-eyebrow">Features</p>
              <h2 id="features-title">Everything a term throws at you</h2>
              <p className="muted">
                Four views that share the same courses, so nothing has to be typed twice.
              </p>
            </div>

            <div className="landing-features">
              {FEATURES.map(({ icon: Icon, eyebrow, title, body, points, shot, alt }) => (
                <article key={eyebrow} className="landing-feature">
                  <div className="landing-feature-text">
                    <p className="landing-feature-eyebrow">
                      <Icon size={18} aria-hidden="true" />
                      {eyebrow}
                    </p>
                    <h3>{title}</h3>
                    <p className="muted">{body}</p>
                    <ul className="landing-points">
                      {points.map((point) => (
                        <li key={point}>
                          <Check size={16} strokeWidth={2.5} aria-hidden="true" />
                          {point}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <Shot src={shot} alt={alt} />
                </article>
              ))}
            </div>

            <ul className="landing-extras">
              {EXTRAS.map(({ icon: Icon, title, body }) => (
                <li key={title} className="card">
                  <span className="landing-extra-icon">
                    <Icon size={20} aria-hidden="true" />
                  </span>
                  <h3>{title}</h3>
                  <p className="muted">{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="how-it-works" className="landing-section" aria-labelledby="steps-title">
          <div className="landing-container">
            <div className="landing-section-head">
              <p className="landing-eyebrow">How it works</p>
              <h2 id="steps-title">Set up in a couple of minutes</h2>
            </div>
            <ol className="landing-steps">
              {STEPS.map(({ title, body }) => (
                <li key={title}>
                  <h3>{title}</h3>
                  <p className="muted">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="landing-section" aria-labelledby="start-title">
          <div className="landing-container">
            <div className="landing-final">
              <h2 id="start-title">Get your week under control</h2>
              <p>Free, no credit card, and you can try the full app before you sign up.</p>
              <div className="landing-cta">
                <Link to="/register" className="btn btn-large landing-final-primary">
                  Start now
                </Link>
                <DemoButton label="Try the demo first" className="btn btn-large landing-final-ghost" />
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-container landing-footer-inner">
          <span className="brand">
            <BrandMark size={14} />
            StudyFlow
          </span>
          <span className="muted">Built with FastAPI, PostgreSQL and React.</span>
          <nav className="landing-footer-links" aria-label="Footer">
            <Link to="/login">Log in</Link>
            <Link to="/register">Create an account</Link>
            <a href={SOURCE_URL} target="_blank" rel="noreferrer">
              Source on GitHub
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
