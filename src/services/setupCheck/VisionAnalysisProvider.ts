import type { VisionRequest } from '@/lib/engines/setupValidation';

export interface VisionImage {
  base64: string;
  mimeType: string;
}

export interface VisionResponse {
  /** Raw model output — validated by `parseVisionOutput` before use. */
  raw: unknown;
  model: string | null;
  provider: 'ai' | 'mock';
}

/**
 * Vision interpretation only: evidence + status per VISUAL rule. Providers
 * never decide QUALIFIED / WAIT / STAND DOWN.
 */
export interface VisionAnalysisProvider {
  readonly id: 'remote' | 'mock';
  analyze(image: VisionImage, request: VisionRequest): Promise<VisionResponse>;
}
