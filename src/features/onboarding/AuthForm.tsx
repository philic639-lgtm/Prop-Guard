import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';
import { z } from 'zod';

import { AppText, Button, Card, Input } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { AUTH_PROVIDERS, type AuthProvider } from '@/services/authService';

const schema = z.object({
  name: z.string().trim().max(60).optional(),
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(8, 'At least 8 characters'),
});
export type AuthValues = z.infer<typeof schema>;

interface Props {
  mode: 'sign-in' | 'sign-up';
  loading: boolean;
  error: string | null;
  onSubmit: (v: AuthValues) => void;
  onProvider: (p: Exclude<AuthProvider, 'email'>) => void;
}

export function AuthForm({ mode, loading, error, onSubmit, onProvider }: Props) {
  const { control, handleSubmit } = useForm<AuthValues>({ resolver: zodResolver(schema), defaultValues: { name: '', email: '', password: '' } });
  return (
    <View style={styles.wrap}>
      {mode === 'sign-up' ? (
        <Controller
          control={control}
          name="name"
          render={({ field }) => <Input label="Name" value={field.value} onChangeText={field.onChange} autoCapitalize="words" textContentType="name" placeholder="Your name" />}
        />
      ) : null}
      <Controller
        control={control}
        name="email"
        render={({ field, fieldState }) => (
          <Input label="Email" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} autoCapitalize="none" keyboardType="email-address" textContentType="emailAddress" autoComplete="email" error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={control}
        name="password"
        render={({ field, fieldState }) => (
          <Input
            label="Password"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            secureTextEntry
            textContentType={mode === 'sign-up' ? 'newPassword' : 'password'}
            autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
            error={fieldState.error?.message}
          />
        )}
      />
      {error ? (
        <Card tone="danger">
          <AppText variant="body">{error}</AppText>
        </Card>
      ) : null}
      <Button label={mode === 'sign-up' ? 'Create account' : 'Sign in'} loading={loading} onPress={handleSubmit(onSubmit)} />
      {AUTH_PROVIDERS.filter((p) => p.id !== 'email').map((p) => (
        <Button key={p.id} label={`${p.label}${p.available ? '' : ' — coming soon'}`} variant="secondary" icon={p.id === 'apple' ? 'logo-apple' : 'logo-google'} disabled={!p.available} onPress={() => onProvider(p.id as Exclude<AuthProvider, 'email'>)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { gap: spacing.lg } });
