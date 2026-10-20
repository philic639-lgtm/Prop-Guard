import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Chip, Input, StatusBadge } from '@/components/ui';
import { Icon, type IconName } from '@/components/ui/Icon';
import { colors, radius, spacing, type Tone } from '@/constants/theme';
import { RULE_TAG_LABEL, SCORE_RUBRIC, type Answer, type PlanLine, type PlanQuestion, type PlanScore, type PlanSuggestion, type PlanTestability, type RuleTag } from '@/lib/engines/strategyPlan';

/**
 * The plan screen in three parts — what we understood, what needs clarification, your confirmed
 * plan — plus the definition score, optional ideas to test and practice / testing. Plain language;
 * details stay behind "Show".
 */

const STATUS_ICON: Record<string, { icon: IconName; color: string }> = {
  supplied: { icon: 'checkmark-circle-outline', color: colors.positive },
  accepted: { icon: 'checkmark-circle-outline', color: colors.accentBright },
  not_used: { icon: 'ellipse-outline', color: colors.textTertiary },
  needs_clarification: { icon: 'help-circle-outline', color: colors.warning },
  missing: { icon: 'alert-circle-outline', color: colors.textTertiary },
};

const TAG_TONE: Record<RuleTag, Tone> = { trader_supplied: 'positive', needs_clarification: 'warning', app_suggestion: 'neutral', trader_accepted: 'accent' };

/** Trader supplied / Needs clarification / App suggestion / Trader accepted — the only source labels shown. */
export function TagBadge({ tag }: { tag: RuleTag }) {
  return <StatusBadge label={RULE_TAG_LABEL[tag]} tone={TAG_TONE[tag]} size="sm" />;
}

function Expand({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.gapSm}>
      <Pressable accessibilityRole="button" aria-expanded={open} onPress={() => setOpen((o) => !o)} style={styles.row}>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.accentBright} />
        <AppText variant="caption" tone="accent">
          {label}
        </AppText>
      </Pressable>
      {open ? children : null}
    </View>
  );
}

export function UnderstoodCard({ lines, original, onEdit, onEditDescription }: { lines: PlanLine[]; original: string; onEdit: (key: string) => void; onEditDescription: () => void }) {
  return (
    <Card style={styles.gap}>
      <AppText variant="label" tone="accent">
        WHAT WE UNDERSTOOD
      </AppText>
      {lines.map((l) => {
        const s = STATUS_ICON[l.status] ?? STATUS_ICON.missing;
        const editable = l.key !== 'not_given';
        return (
          <Pressable key={l.key} disabled={!editable} accessibilityRole={editable ? 'button' : undefined} accessibilityLabel={editable ? `${l.text} Edit` : l.text} onPress={() => onEdit(l.key)} style={styles.line}>
            <Icon name={s.icon} size={16} color={s.color} />
            <View style={styles.flex}>
              <AppText variant="body">{l.text}</AppText>
              <TagBadge tag={l.tag} />
              {l.evidence && l.status !== 'missing' ? (
                <AppText variant="caption" tone="tertiary" numberOfLines={2}>
                  “{l.evidence}”
                </AppText>
              ) : null}
            </View>
            {editable ? <Icon name="create-outline" size={14} color={colors.textTertiary} /> : null}
          </Pressable>
        );
      })}
      <Expand label="Your original description">
        <AppText variant="caption" tone="secondary">
          {original}
        </AppText>
        <Button label="Edit description" size="md" variant="ghost" icon="create-outline" onPress={onEditDescription} />
      </Expand>
    </Card>
  );
}

export function QuestionCard({ q, onAnswer }: { q: PlanQuestion; onAnswer: (a: Answer) => void }) {
  const [text, setText] = useState('');
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onAnswer(q.custom?.numeric ? { number: Number(t.replace(/[$,\s]/g, '')), text: t } : { text: t });
    setText('');
  };
  return (
    <View style={styles.question}>
      <View style={styles.row}>
        <AppText variant="bodyStrong" style={styles.flex}>
          {q.title}
        </AppText>
        {q.optional ? <StatusBadge label="Optional" tone="neutral" size="sm" /> : null}
      </View>
      <AppText variant="body">{q.question}</AppText>
      <Expand label="Why this matters">
        <AppText variant="caption" tone="secondary">
          {q.why}
        </AppText>
      </Expand>
      <View style={styles.chips}>
        {q.choices.map((c) =>
          // Long choices wrap on a phone; short ones stay compact chips.
          c.label.length > 28 ? (
            <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={c.label} onPress={() => onAnswer(c.apply)} style={({ pressed }) => [styles.option, pressed && { opacity: 0.8 }]}>
              {c.fromSaved ? <Icon name="bookmark-outline" size={14} color={colors.textSecondary} /> : null}
              <AppText variant="bodyStrong" tone="secondary" style={styles.flex}>
                {c.label}
              </AppText>
            </Pressable>
          ) : (
            <Chip key={c.id} label={c.label} icon={c.fromSaved ? 'bookmark-outline' : undefined} onPress={() => onAnswer(c.apply)} />
          ),
        )}
      </View>
      {q.choices.some((c) => c.fromSaved) ? (
        <AppText variant="caption" tone="tertiary">
          Saved settings are only used for this strategy if you pick them here.
        </AppText>
      ) : null}
      {q.custom ? (
        <View style={styles.row}>
          <View style={styles.flex}>
            <Input value={text} onChangeText={setText} placeholder={q.custom.placeholder} prefix={q.custom.unit} keyboardType={q.custom.numeric ? 'decimal-pad' : 'default'} onSubmitEditing={submit} accessibilityLabel={`Your answer: ${q.title}`} />
          </View>
          <Button label="Save" size="md" onPress={submit} disabled={!text.trim()} />
        </View>
      ) : null}
    </View>
  );
}

export function ClarifyCard({ questions, onAnswer }: { questions: PlanQuestion[]; onAnswer: (id: string, a: Answer) => void }) {
  const [all, setAll] = useState(false);
  const required = questions.filter((q) => !q.optional);
  const shown = all ? questions : questions.slice(0, 3);
  if (!questions.length)
    return (
      <Card tone="positive">
        <AppText variant="bodyStrong">Nothing left to clarify</AppText>
        <AppText variant="caption" tone="secondary">
          Every rule this plan needs is defined.
        </AppText>
      </Card>
    );
  return (
    <Card style={styles.gap}>
      <AppText variant="label" tone="warning">
        WHAT NEEDS CLARIFICATION · {required.length} open
      </AppText>
      {shown.map((q) => (
        <QuestionCard key={q.id} q={q} onAnswer={(a) => onAnswer(q.id, a)} />
      ))}
      {questions.length > 3 ? <Button label={all ? 'Show fewer' : `Show all ${questions.length} questions`} size="md" variant="ghost" onPress={() => setAll((x) => !x)} /> : null}
    </Card>
  );
}

export function ConfirmedPlanCard({ lines, draft, unresolved }: { lines: PlanLine[]; draft: boolean; unresolved: string[] }) {
  return (
    <Card style={styles.gap}>
      <View style={styles.row}>
        <AppText variant="label" tone="positive" style={styles.flex}>
          YOUR CONFIRMED PLAN
        </AppText>
        <StatusBadge label={draft ? 'Draft' : 'Complete'} tone={draft ? 'warning' : 'positive'} size="sm" />
      </View>
      {lines.length ? (
        lines.map((l) => (
          <View key={l.key} style={styles.line}>
            <Icon name={(STATUS_ICON[l.status] ?? STATUS_ICON.supplied).icon} size={16} color={(STATUS_ICON[l.status] ?? STATUS_ICON.supplied).color} />
            <View style={styles.flex}>
              <AppText variant="body">{l.text}</AppText>
              <TagBadge tag={l.tag} />
              {l.sourceLabel ? (
                <AppText variant="caption" tone="tertiary">
                  {l.sourceLabel}
                </AppText>
              ) : null}
            </View>
          </View>
        ))
      ) : (
        <AppText variant="caption" tone="secondary">
          Nothing confirmed yet.
        </AppText>
      )}
      {draft ? (
        <AppText variant="caption" tone="warning">
          Still to define: {unresolved.join(', ')}. You can save it as a draft and finish later.
        </AppText>
      ) : null}
    </Card>
  );
}

const scoreTone = (n: number): Tone => (n >= 80 ? 'positive' : n >= 50 ? 'accent' : 'warning');

export function PlanScoreCard({ score }: { score: PlanScore }) {
  const lost = score.lines.reduce((n, l) => n + l.possible - l.earned, 0);
  const possible = score.lines.reduce((n, l) => n + l.possible, 0);
  return (
    <Card style={styles.gap}>
      <View style={styles.row}>
        <AppText variant="label" style={styles.flex}>
          STRATEGY DEFINITION SCORE
        </AppText>
        <StatusBadge label={`${score.score} / 100`} tone={scoreTone(score.score)} />
      </View>
      <AppText variant="caption" tone="secondary">
        How completely and clearly your rules are defined — not whether the strategy makes money. It is recalculated from your current plan after every confirmed change.
      </AppText>
      <AppText variant="caption" tone="tertiary">
        {possible - lost} of {possible} points{lost ? ` · ${lost} deducted` : ''} → {score.score}/100.
      </AppText>
      {score.lines.map((l) => {
        const full = l.earned === l.possible;
        return (
          <View key={l.key} style={styles.line}>
            <Icon name={full ? 'checkmark-circle-outline' : 'remove-circle-outline'} size={14} color={full ? colors.positive : colors.warning} />
            <View style={styles.flex}>
              <AppText variant="caption">{l.label}</AppText>
              {!full ? (
                <AppText variant="caption" tone="warning">
                  −{l.possible - l.earned} · {l.reason}
                </AppText>
              ) : null}
            </View>
            <AppText variant="caption" tone="secondary">
              {l.earned}/{l.possible}
            </AppText>
          </View>
        );
      })}
      <Expand label="How this is scored">
        <AppText variant="caption" tone="tertiary">
          {SCORE_RUBRIC}
        </AppText>
      </Expand>
    </Card>
  );
}

export function SuggestionsCard({ suggestions, onDecide }: { suggestions: PlanSuggestion[]; onDecide: (id: string, status: 'accepted' | 'rejected' | 'pending') => void }) {
  const visible = suggestions.filter((s) => s.status !== 'rejected');
  if (!visible.length) return null;
  return (
    <Card style={styles.gap}>
      <AppText variant="label">OPTIONAL IDEAS TO TEST</AppText>
      <AppText variant="caption" tone="secondary">
        Inactive — not part of your plan, score or practice unless you accept them. They are hypotheses to test in practice, not proof of an edge.
      </AppText>
      {visible.map((s) => (
        <View key={s.id} style={styles.question}>
          <View style={styles.row}>
            <AppText variant="bodyStrong" style={styles.flex}>
              {s.title}
            </AppText>
            <TagBadge tag={s.status === 'accepted' ? 'trader_accepted' : 'app_suggestion'} />
          </View>
          <AppText variant="body">{s.rule}</AppText>
          <AppText variant="caption" tone="tertiary">
            {s.hypothesis}
            {s.status === 'accepted' && s.decidedAt ? ` Accepted ${s.decidedAt.slice(0, 10)}.` : ''}
          </AppText>
          <View style={styles.row}>
            {s.status === 'accepted' ? (
              <Button label="Remove from plan" size="md" variant="ghost" onPress={() => onDecide(s.id, 'pending')} />
            ) : (
              <>
                <Button label="Add to my plan" size="md" variant="secondary" onPress={() => onDecide(s.id, 'accepted')} />
                <Button label="Not for me" size="md" variant="ghost" onPress={() => onDecide(s.id, 'rejected')} />
              </>
            )}
          </View>
        </View>
      ))}
    </Card>
  );
}

export function TestingCard({ testability, unresolved, onPractice }: { testability: PlanTestability; unresolved: string[]; onPractice: () => void }) {
  return (
    <Card style={styles.gap}>
      <AppText variant="label">PRACTICE & TESTING</AppText>
      <AppText variant="bodyStrong">Manual practice</AppText>
      <AppText variant="caption" tone="secondary">
        {testability.manual.note}
      </AppText>
      {unresolved.length ? (
        <AppText variant="caption" tone="warning">
          Before testing: {unresolved.length} rule{unresolved.length > 1 ? 's are' : ' is'} not defined yet ({unresolved.join(', ')}). Prop Guard will not fill them in — without them a test cannot follow your plan exactly.
        </AppText>
      ) : null}
      <Button label="Practice manually" size="md" variant="secondary" icon="time-outline" onPress={onPractice} />
      <AppText variant="bodyStrong">Automated testing</AppText>
      {testability.automated.available ? (
        <AppText variant="caption" tone="secondary">
          Available: your rules are precise and verified historical data is connected.
        </AppText>
      ) : (
        <>
          <AppText variant="caption" tone="secondary">
            Not available yet — no automated results are shown:
          </AppText>
          {testability.automated.reasons.map((r) => (
            <AppText key={r} variant="caption" tone="tertiary">
              • {r}
            </AppText>
          ))}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.sm },
  gapSm: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  flex: { flex: 1, minWidth: 0 },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  option: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  question: { gap: spacing.xs, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
});
