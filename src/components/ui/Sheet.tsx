import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, spacing, toneColor, type Tone } from '@/constants/theme';

import { AppText } from './AppText';
import { Button } from './Button';

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

export function Sheet({ visible, onClose, title, children }: SheetProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <View style={styles.handle} />
          {title ? (
            <AppText variant="label" tone="primary" style={styles.title} accessibilityRole="header">
              {title}
            </AppText>
          ) : null}
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

interface ConfirmationSheetProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
  children?: ReactNode;
}

export function ConfirmationSheet({ visible, title, message, confirmLabel, cancelLabel = 'Cancel', onConfirm, onCancel, destructive, children }: ConfirmationSheetProps) {
  return (
    <Sheet visible={visible} onClose={onCancel} title={title}>
      <AppText variant="body" tone="secondary">
        {message}
      </AppText>
      {children}
      <View style={styles.actions}>
        <Button label={confirmLabel} variant={destructive ? 'danger' : 'primary'} onPress={onConfirm} />
        <Button label={cancelLabel} variant="ghost" onPress={onCancel} />
      </View>
    </Sheet>
  );
}

interface WarningSheetProps {
  visible: boolean;
  title: string;
  tone?: Extract<Tone, 'warning' | 'danger'>;
  heading?: string;
  lines: string[];
  question?: string;
  /** When absent, the user cannot override — only cancel. */
  overrideLabel?: string;
  cancelLabel?: string;
  onOverride?: () => void;
  onCancel: () => void;
  children?: ReactNode;
}

/** Rule-break warning. Overrides are always recorded by the caller. */
export function WarningSheet({
  visible,
  title,
  tone = 'warning',
  heading = 'WARNING',
  lines,
  question,
  overrideLabel,
  cancelLabel = 'Cancel',
  onOverride,
  onCancel,
  children,
}: WarningSheetProps) {
  const c = toneColor[tone];
  return (
    <Sheet visible={visible} onClose={onCancel} title={title}>
      {children}
      <View style={[styles.warning, { backgroundColor: c.bg, borderColor: c.fg + '55' }]}>
        <View style={styles.warningHead}>
          <Ionicons name="warning" size={18} color={c.fg} />
          <AppText variant="label" style={{ color: c.fg }}>
            {heading}
          </AppText>
        </View>
        {lines.map((l) => (
          <AppText key={l} variant="body">
            {l}
          </AppText>
        ))}
      </View>
      {question ? <AppText variant="bodyStrong">{question}</AppText> : null}
      <View style={styles.actions}>
        <Button label={cancelLabel} onPress={onCancel} />
        {overrideLabel && onOverride ? <Button label={overrideLabel} variant={tone === 'danger' ? 'danger' : 'warning'} onPress={onOverride} /> : null}
      </View>
      {overrideLabel ? (
        <AppText variant="caption" tone="tertiary" align="center">
          Overrides are recorded in your Discipline Score.
        </AppText>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.overlay },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    maxHeight: '88%',
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginTop: spacing.sm },
  title: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, fontSize: 13 },
  body: { padding: spacing.xl, gap: spacing.lg },
  actions: { gap: spacing.sm, marginTop: spacing.xs },
  warning: { borderRadius: radius.md, borderWidth: 1, padding: spacing.lg, gap: spacing.sm },
  warningHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
