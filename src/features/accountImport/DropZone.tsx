import type { ReactNode } from 'react';
import { View } from 'react-native';

import type { ImportImage } from '@/services/accountImport/images';

/** Native: no drag and drop — the upload / camera buttons are used. */
export function DropZone({ children }: { children: ReactNode; onFiles: (images: ImportImage[]) => void }) {
  return <View>{children}</View>;
}

export const DROP_SUPPORTED = false;
