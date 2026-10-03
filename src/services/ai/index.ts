import { env, isDemoMode } from '@/config/env';

import { MockAIProvider } from './mockProvider';
import type { AIProvider } from './provider';
import { RemoteAIProvider } from './remoteProvider';

export * from './types';
export type { AIProvider } from './provider';

function createProvider(): AIProvider {
  if (env.aiMode === 'remote' && !isDemoMode) return new RemoteAIProvider();
  return new MockAIProvider();
}

/** The app-wide AI service. Swap providers here without touching screens. */
export const aiService: AIProvider = createProvider();

export const aiIsLive = aiService instanceof RemoteAIProvider;
