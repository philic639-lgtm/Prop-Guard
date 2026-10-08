/**
 * Beginner learning path — "PLAN YOUR TRADE."
 *
 * Eight short modules. Lessons are data: text, key points, visuals (the same
 * strategy diagrams as the Strategy Library), interactive examples (backed by
 * the app's real risk engines), quizzes and practice actions that open the
 * real feature (account setup, Practice, Journal…).
 *
 * Content rules: educational only — no profit claims, no "proven" or "high
 * win rate" language, and historical testing is described as practice unless
 * verified historical data was actually used.
 */

export type WidgetKind = 'drawdownSimulator' | 'dailyLossCalculator' | 'positionSizer' | 'rrCalculator' | 'consistencyChecker';

export interface QuizQuestion {
  id: string;
  prompt: string;
  choices: string[];
  answer: number;
  explanation: string;
}

export type LessonBlock =
  | { kind: 'text'; title?: string; body: string }
  | { kind: 'keyPoints'; points: string[] }
  | { kind: 'visual'; templateId: string; caption: string }
  | { kind: 'interactive'; widget: WidgetKind; caption: string }
  | { kind: 'quiz'; questions: QuizQuestion[] }
  | { kind: 'practice'; title: string; body: string; action: { label: string; route: string; params?: Record<string, string> } };

export interface Lesson {
  id: string;
  title: string;
  minutes: number;
  summary: string;
  blocks: LessonBlock[];
}

export interface LearningModule {
  id: string;
  n: number;
  title: string;
  description: string;
  icon: 'business-outline' | 'shield-outline' | 'person-outline' | 'compass-outline' | 'trending-up-outline' | 'flask-outline' | 'map-outline' | 'book-outline';
  lessons: Lesson[];
}

const q = (id: string, prompt: string, choices: string[], answer: number, explanation: string): QuizQuestion => ({ id, prompt, choices, answer, explanation });

export const CURRICULUM: LearningModule[] = [
  {
    id: 'prop-firms',
    n: 1,
    title: 'How prop firms work',
    description: 'Evaluations, funded accounts and what you are really being tested on.',
    icon: 'business-outline',
    lessons: [
      {
        id: 'prop-firms-basics',
        title: 'What a prop firm is',
        minutes: 3,
        summary: 'You trade the firm’s account under the firm’s rules.',
        blocks: [
          { kind: 'text', body: 'A futures prop firm lets you trade an account it provides, under its rules. You pay for an evaluation; if you follow the rules and reach the target, you get a funded account and can request payouts on profits.' },
          { kind: 'text', title: 'The real test', body: 'An evaluation is mostly a risk-management test. Firms end accounts for breaking a loss rule far more often than for missing a target. Protecting the account comes first; profit comes from repeating a plan inside the rules.' },
          { kind: 'keyPoints', points: ['You trade the firm’s capital under the firm’s rules.', 'Breaking a loss rule ends or pauses the account.', 'Every firm, program, size and stage has its own rules — never assume they are the same.'] },
          {
            kind: 'quiz',
            questions: [
              q('pf1', 'What ends most evaluation accounts?', ['Missing the profit target', 'Breaking a loss rule', 'Trading too few days'], 1, 'Loss rules (drawdown, daily loss) are hard limits. Missing a target only means you keep trading.'),
              q('pf2', 'Two 50K programs at the same firm…', ['always have the same rules', 'can have different rules', 'only differ in price'], 1, 'Rules are per program, size and stage. Prop Guard loads them per exact configuration.'),
            ],
          },
        ],
      },
      {
        id: 'prop-firms-stages',
        title: 'Evaluation → funded → live',
        minutes: 3,
        summary: 'The stages, and why “funded” is usually simulated.',
        blocks: [
          { kind: 'text', body: 'Most programs have stages: an evaluation (pass the target without breaking rules), a funded account (usually SIMULATED — payouts are real, trades are not routed to the market) and sometimes a live account with real capital. Each stage can have different rules: consistency, daily loss, payout requirements.' },
          { kind: 'keyPoints', points: ['Evaluation: reach the target inside the rules.', 'Funded (simulated): payouts depend on payout rules — buffers, consistency, minimum days.', 'Live: real capital, often stricter risk.'] },
          { kind: 'practice', title: 'See a real program', body: 'Add your prop account: pick firm → program → stage → size and Prop Guard loads the verified rules with their official source. Firms that aren’t verified yet are entered manually.', action: { label: 'Set up my account', route: '/accounts/new' } },
          { kind: 'quiz', questions: [q('pf3', 'A “funded” account at most firms is…', ['always real capital', 'usually simulated, with real payouts', 'a demo with no payouts'], 1, 'Most funded stages are simulated; read each firm’s terms.')] },
        ],
      },
    ],
  },
  {
    id: 'account-protection',
    n: 2,
    title: 'Protect the account',
    description: 'Drawdown, daily loss limits, payout rules and risk per trade.',
    icon: 'shield-outline',
    lessons: [
      {
        id: 'protection-drawdown',
        title: 'Maximum drawdown',
        minutes: 5,
        summary: 'Static vs trailing vs end-of-day trailing — and lock points.',
        blocks: [
          { kind: 'text', body: 'The maximum drawdown is the lowest balance your account may touch. A STATIC drawdown never moves. A TRAILING drawdown follows your highest balance up — intraday trailing follows every peak, end-of-day (EOD) trailing only the closing balance. Many firms stop the trailing at a lock point, such as the starting balance or the starting balance plus a small amount.' },
          { kind: 'interactive', widget: 'drawdownSimulator', caption: 'Move the closing balance day by day and watch the floor follow it — calculated by the same engine as your account dashboard.' },
          { kind: 'keyPoints', points: ['Profits move a trailing floor up — your room does not grow with them.', 'Know your lock point: after it, the floor stops moving.', 'Your “buffer” is balance − floor. Size trades so one loss can’t eat it.'] },
          {
            kind: 'quiz',
            questions: [
              q('dd1', 'With an EOD trailing drawdown, a big winning day…', ['raises the floor at the close', 'never changes the floor', 'lowers the floor'], 0, 'The floor follows the highest closing balance until it locks.'),
              q('dd2', 'Your buffer is…', ['the profit target', 'balance minus the drawdown floor', 'the daily loss limit'], 1, 'Buffer = how far the balance can fall before the account is breached.'),
            ],
          },
        ],
      },
      {
        id: 'protection-daily-loss',
        title: 'Daily loss limits',
        minutes: 4,
        summary: 'Hard vs soft limits, optional limits and your personal stop.',
        blocks: [
          { kind: 'text', body: 'A daily loss limit caps how much you may lose in one session. A HARD limit fails the account; a SOFT limit locks you out until the next session. Some programs let you buy the account with or without a daily loss limit, and some scale the limit as the account grows. Your personal daily stop should sit inside the firm’s limit.' },
          { kind: 'interactive', widget: 'dailyLossCalculator', caption: 'Enter today’s result and the risk on your next trade — see what is left and whether the next trade fits.' },
          { kind: 'quiz', questions: [q('dl1', 'A “soft” daily loss limit usually means…', ['the account fails', 'you’re locked out for the rest of the session', 'nothing happens'], 1, 'Soft = paused until the next session; the max drawdown still applies.'), q('dl2', 'Your personal daily stop should be…', ['above the firm’s limit', 'inside the firm’s limit', 'ignored if the firm has one'], 1, 'Stop yourself before the firm has to.')] },
        ],
      },
      {
        id: 'protection-payouts',
        title: 'Payout rules & consistency',
        minutes: 4,
        summary: 'Buffers, minimum days and the consistency rule.',
        blocks: [
          { kind: 'text', body: 'Funded accounts pay out only when payout rules are met: a minimum profit, sometimes a number of profitable days, a balance buffer that must stay in the account, and often a CONSISTENCY rule — your biggest day may be at most a set percentage of total profit. One huge day can delay a payout.' },
          { kind: 'interactive', widget: 'consistencyChecker', caption: 'Check a consistency rule: best day ÷ total profit.' },
          { kind: 'quiz', questions: [q('po1', 'Best day $900, total profit $1,500, rule 40% — eligible?', ['Yes', 'No — 60% is above 40%'], 1, '900 ÷ 1,500 = 60%. Keep trading normal size until the best day is ≤ 40% of profit.')] },
        ],
      },
      {
        id: 'protection-risk-per-trade',
        title: 'Risk per trade & position size',
        minutes: 5,
        summary: 'Contracts come from your stop and your risk budget — never the other way round.',
        blocks: [
          { kind: 'text', body: 'Decide the dollars you are willing to lose on one trade first. Then the stop distance and the contract’s value per point decide how many contracts fit. A wider stop means fewer contracts. Micro contracts let you keep the same stop with smaller risk.' },
          { kind: 'interactive', widget: 'positionSizer', caption: 'Same math as Check Trade and the Risk Calculator — uses each contract’s real point value.' },
          { kind: 'quiz', questions: [q('rp1', 'Your stop needs to be wider. To keep the same dollar risk you…', ['add contracts', 'reduce contracts or use micros', 'move the stop closer anyway'], 1, 'Risk = points × point value × contracts. Wider stop → fewer contracts.')] },
          { kind: 'practice', title: 'Set your risk rules', body: 'Your max risk per trade, daily stop and trade limit are enforced in every check.', action: { label: 'Open my rules', route: '/settings/rules' } },
        ],
      },
    ],
  },
  {
    id: 'personality',
    n: 3,
    title: 'Your trading personality',
    description: 'Hours, emotions, frequency and risk limits — what fits you.',
    icon: 'person-outline',
    lessons: [
      {
        id: 'personality-assessment',
        title: 'Trading personality assessment',
        minutes: 4,
        summary: 'Nine questions → your archetype and starting rules.',
        blocks: [
          { kind: 'text', body: 'A plan that fits your schedule and temperament is one you can actually follow. Answer honestly — there are no right answers. The result sets starting rules you can change any time; it never raises your risk above the limits you choose.' },
          { kind: 'practice', title: 'Take the assessment', body: 'Available hours, session, how you react to losses, preferred frequency, hold time and your own risk limits.', action: { label: 'Start the assessment', route: '/learn/personality' } },
        ],
      },
    ],
  },
  {
    id: 'strategy-discovery',
    n: 4,
    title: 'Find strategies that fit',
    description: 'Match your personality to the Strategy Library.',
    icon: 'compass-outline',
    lessons: [
      {
        id: 'discovery-matches',
        title: 'Your strategy matches',
        minutes: 4,
        summary: 'Fit scores explain structure — they are never win rates.',
        blocks: [
          { kind: 'text', body: 'Prop Guard compares your answers with each framework’s session, frequency, hold time and style. The fit score shows how well the STRUCTURE fits you — it is not a probability of profit, and no template comes with a promised win rate.' },
          { kind: 'practice', title: 'See your matches', body: 'Built from your assessment (or your profile if you skipped it).', action: { label: 'Show my matches', route: '/learn/strategies' } },
          { kind: 'quiz', questions: [q('sd1', 'A 90% fit score means…', ['90% of trades win', 'the strategy’s structure fits your answers well', 'the strategy is proven'], 1, 'Fit is about schedule, style and frequency — never results.')] },
        ],
      },
    ],
  },
  {
    id: 'charts',
    n: 5,
    title: 'Charts: entries, exits & stops',
    description: 'Visual walkthroughs of common setups.',
    icon: 'trending-up-outline',
    lessons: [
      {
        id: 'charts-breakout',
        title: 'Breakout and retest',
        minutes: 4,
        summary: 'Wait for the break, the close and the retest.',
        blocks: [
          { kind: 'visual', templateId: 'orb-15', caption: 'Opening-range breakout with a retest — numbered steps, entry, stop and target.' },
          { kind: 'keyPoints', points: ['A close beyond the level matters more than a wick.', 'The retest gives a defined stop.', 'Chasing an extended candle widens your risk.'] },
        ],
      },
      {
        id: 'charts-pullback',
        title: 'Pullbacks and continuation',
        minutes: 4,
        summary: 'Trend → pullback → confirmation → entry.',
        blocks: [
          { kind: 'visual', templateId: 'icc', caption: 'Indication → correction → continuation: enter only when the move resumes.' },
          { kind: 'keyPoints', points: ['Don’t buy the first impulse candle.', 'A retrace alone is not an entry — wait for confirmation.', 'Stop goes beyond the pullback swing.'] },
        ],
      },
      {
        id: 'charts-stops-targets',
        title: 'Stops, targets and R:R',
        minutes: 4,
        summary: 'Place the stop where the idea is wrong; the target where structure is.',
        blocks: [
          { kind: 'text', body: 'Put the stop where your idea is invalidated (beyond the level or swing), not at a round dollar amount. Targets go to logical structure — the next level or swing. Reward ÷ risk (R:R) tells you if the trade is worth taking.' },
          { kind: 'interactive', widget: 'rrCalculator', caption: 'Entry, stop and target → points, dollars and R:R.' },
          { kind: 'quiz', questions: [q('ch1', 'Entry 100, stop 98, target 106. R:R is…', ['1:2', '1:3', '1:6'], 1, 'Risk 2 points, reward 6 → 1:3.')] },
        ],
      },
    ],
  },
  {
    id: 'practice',
    n: 6,
    title: 'Practice & testing',
    description: 'Replay setups without risk — honestly labelled.',
    icon: 'flask-outline',
    lessons: [
      {
        id: 'practice-honest-testing',
        title: 'Practice without risk',
        minutes: 4,
        summary: 'Educational samples, simulated scenarios and verified history are different things.',
        blocks: [
          { kind: 'text', body: 'Practice Mode replays setups so you can decide take / skip / wait and see the outcome. It labels where every scenario comes from: EDUCATIONAL samples and SIMULATED scenarios are for practice only; VERIFIED historical scenarios come from real market data when it is available. Only verified history can feed historical statistics, and practice results are your decisions — not a backtest of profits.' },
          { kind: 'keyPoints', points: ['Practice builds pattern recognition and rule discipline.', 'Simulated results are never presented as real performance.', 'No practice result predicts future profit.'] },
          { kind: 'practice', title: 'Practice a setup', body: 'Start a short session with your strategy (or a library framework).', action: { label: 'Open Practice', route: '/practice' } },
        ],
      },
    ],
  },
  {
    id: 'plan',
    n: 7,
    title: 'Build your trading plan',
    description: 'Strategy + account + risk + routine on one page.',
    icon: 'map-outline',
    lessons: [
      {
        id: 'plan-builder',
        title: 'Your personalized plan',
        minutes: 5,
        summary: 'PLAN YOUR TRADE — before the session, not during it.',
        blocks: [
          { kind: 'text', body: 'Your plan puts it all together: one strategy, the markets and session you trade, your risk rules (inside your firm’s limits), position size at a typical stop, a pre-trade checklist and a review routine. Prop Guard then checks every trade against it.' },
          { kind: 'practice', title: 'Build my plan', body: 'Uses your assessment, your chosen strategy and your account’s verified rules.', action: { label: 'Build my plan', route: '/learn/plan' } },
        ],
      },
    ],
  },
  {
    id: 'improve',
    n: 8,
    title: 'Journal, review, improve',
    description: 'Turn every trade into feedback.',
    icon: 'book-outline',
    lessons: [
      {
        id: 'improve-journal',
        title: 'Journal every trade',
        minutes: 3,
        summary: 'Checked trades are journaled automatically — add the result and a note.',
        blocks: [
          { kind: 'text', body: 'Every trade you check in Prop Guard is saved as a pending journal entry. Add the result and one sentence: did you follow the plan? Setups you correctly skipped are saved as setup reviews — avoiding a bad trade is a win too.' },
          { kind: 'practice', title: 'Open the journal', body: 'Pending results, trades and setup reviews.', action: { label: 'Open Journal', route: '/journal' } },
        ],
      },
      {
        id: 'improve-review',
        title: 'Review and improve one rule at a time',
        minutes: 4,
        summary: 'Use your own numbers, change one thing, measure again.',
        blocks: [
          { kind: 'text', body: 'After enough trades, look for patterns in YOUR data: which setups, sessions and rule breaks cost the most. Change one rule at a time and measure again. Small samples are noisy — Prop Guard waits for enough trades before it suggests anything.' },
          { kind: 'practice', title: 'See my performance', body: 'Performance and discipline insights from your own journal.', action: { label: 'Open Performance', route: '/performance' } },
          { kind: 'quiz', questions: [q('im1', 'Best way to improve a strategy?', ['Change several rules at once', 'Change one rule, then measure on new trades', 'Double size after a loss'], 1, 'One change at a time keeps cause and effect clear.')] },
        ],
      },
    ],
  },
];

export const ALL_LESSONS: Lesson[] = CURRICULUM.flatMap((m) => m.lessons);
export const findLesson = (id: string | null | undefined) => ALL_LESSONS.find((l) => l.id === id) ?? null;
export const moduleOfLesson = (id: string) => CURRICULUM.find((m) => m.lessons.some((l) => l.id === id)) ?? null;
